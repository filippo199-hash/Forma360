/**
 * worker-smoke.ts — cold-boot smoke for the Railway `worker` service.
 *
 * Boots the REAL worker entry (`src/main.ts`, the same file `pnpm start`
 * runs) against real Postgres + Redis, waits until every repeatable
 * schedule the worker promises is actually registered in Redis, then
 * SIGTERMs it and asserts the graceful-shutdown path exits 0.
 *
 * Why this exists: every `ctx.enqueue` site once spelled queue names
 * `forma360:<name>` while the registry used `forma360-<name>`, and four
 * queues never ran — nothing at unit level boots the worker for real.
 * The unit suite pins enqueue-name parity statically
 * (`enqueue-names.test.ts`); this script covers the other half: the
 * process comes up under a production-shaped env, connects, registers
 * its schedulers, and shuts down cleanly.
 *
 * The expected scheduler count is scraped from `src/worker.ts` (its
 * `upsertJobScheduler(` call sites), so adding a repeatable updates the
 * expectation automatically — the same self-updating pattern as
 * enqueue-names.test.ts.
 *
 * Usage (CI's deploy-smoke job):
 *   DATABASE_URL=… REDIS_URL=… pnpm --filter @forma360/jobs exec tsx worker-smoke.ts
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_NAMES } from './src/queues';

const here = dirname(fileURLToPath(import.meta.url));

const BOOT_TIMEOUT_MS = 120_000;
const SHUTDOWN_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 2_000;

const workerSource = readFileSync(join(here, 'src', 'worker.ts'), 'utf8');
const expectedSchedulers = (workerSource.match(/upsertJobScheduler\(/g) ?? []).length;
if (expectedSchedulers === 0) {
  console.error('[worker-smoke] FAIL — found no upsertJobScheduler call sites in src/worker.ts');
  process.exit(1);
}

const redisUrl = process.env.REDIS_URL;
if (redisUrl === undefined) {
  console.error('[worker-smoke] FAIL — REDIS_URL is required');
  process.exit(1);
}

console.log(`[worker-smoke] expecting ${expectedSchedulers} repeatable schedulers`);

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queues = Object.values(QUEUE_NAMES).map((name) => new Queue(name, { connection }));

async function countSchedulers(): Promise<number> {
  let total = 0;
  for (const q of queues) {
    total += (await q.getJobSchedulers()).length;
  }
  return total;
}

// Schedulers persist in Redis across runs (that is their job), so a
// previous run's registrations would satisfy the poll before this boot
// registered anything. Start from a clean slate.
for (const q of queues) {
  for (const s of await q.getJobSchedulers()) {
    if (s.key !== undefined) await q.removeJobScheduler(s.key);
  }
}
if ((await countSchedulers()) !== 0) {
  console.error('[worker-smoke] FAIL — could not clear pre-existing job schedulers');
  process.exit(1);
}

// tsx is spawned directly (not through `pnpm start`): pnpm does not
// forward SIGTERM to the script cleanly, so the graceful-shutdown
// assertion would test pnpm's signal handling instead of the worker's.
const child = spawn(join(here, 'node_modules', '.bin', 'tsx'), ['src/main.ts'], {
  cwd: here,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

const exited = new Promise<number | null>((resolve) => {
  child.on('exit', (code) => resolve(code));
});

function fail(reason: string): never {
  console.error(`[worker-smoke] FAIL — ${reason}`);
  console.error('---- worker output ----');
  console.error(output.slice(-8_000));
  child.kill('SIGKILL');
  process.exit(1);
}

const deadline = Date.now() + BOOT_TIMEOUT_MS;
let registered = 0;
for (;;) {
  if (child.exitCode !== null) {
    fail(`worker exited early with code ${child.exitCode}`);
  }
  registered = await countSchedulers();
  if (registered >= expectedSchedulers) break;
  if (Date.now() > deadline) {
    fail(
      `timed out after ${BOOT_TIMEOUT_MS / 1000}s with ${registered}/${expectedSchedulers} schedulers registered`,
    );
  }
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}
console.log(`[worker-smoke] all ${registered} schedulers registered`);

// Graceful shutdown: SIGTERM must drain and exit 0 (Railway's stop path).
child.kill('SIGTERM');
const code = await Promise.race([
  exited,
  new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), SHUTDOWN_TIMEOUT_MS)),
]);
if (code === 'timeout') {
  fail(`worker did not exit within ${SHUTDOWN_TIMEOUT_MS / 1000}s of SIGTERM`);
}
if (code !== 0) {
  fail(`worker exited ${code} on SIGTERM instead of 0`);
}

console.log('[worker-smoke] OK — booted, registered schedulers, shut down cleanly');
await Promise.all(queues.map((q) => q.close()));
connection.disconnect();
process.exit(0);
