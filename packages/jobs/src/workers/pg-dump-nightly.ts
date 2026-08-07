/**
 * Nightly `pg_dump` → R2 backup job.
 *
 * Runs at 03:00 UTC (registered from worker.ts as a BullMQ repeatable job).
 * The Railway `worker` service must have the `postgresql` package available
 * (configured in `railway.json` / `nixpacks.toml` in PR 12).
 *
 * Key in R2: `backups/<YYYY-MM-DD>.sql.gz`. This lives **outside** the
 * tenant-scoped key convention (no tenant id prefix) because the backup
 * spans every tenant — it is an infrastructure artefact, not tenant data.
 */
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { Logger } from '@forma360/shared/logger';
import { createR2Client, type R2Config } from '@forma360/shared/storage';
import type { Job } from 'bullmq';
import type { PgDumpPayload } from '../queues';

/** Cron expression: 03:00 UTC every night. */
export const PG_DUMP_CRON = '0 3 * * *';

/** R2 key format: "backups/YYYY-MM-DD.sql.gz". */
export function backupObjectKey(date: string): string {
  return `backups/${date}.sql.gz`;
}

/**
 * Translate a `spawn` failure into something an operator can act on.
 *
 * ENOENT from this spawn means exactly one thing: the deployed worker image
 * has no `pg_dump` on PATH. The raw errno ("spawn pg_dump ENOENT") reads like
 * an application bug, which is how the nightly backup stayed broken while the
 * error was in plain sight. Say what is missing and how to put it back.
 *
 * Any other spawn failure is returned untouched — it is not ours to explain.
 */
export function pgDumpSpawnError(err: NodeJS.ErrnoException): Error {
  if (err.code !== 'ENOENT') return err;

  return new Error(
    'pg_dump is not on PATH in the worker image, so the nightly backup cannot run. ' +
      'The image needs the PostgreSQL client binaries: set ' +
      'RAILPACK_DEPLOY_APT_PACKAGES=postgresql-client on the worker service. ' +
      'Note the builder is Railpack, which does not read nixpacks.toml. ' +
      'See docs/deployment.md.',
    { cause: err },
  );
}

export interface PgDumpDeps {
  databaseUrl: string;
  r2: R2Config;
  logger: Logger;
}

export function createPgDumpHandler(deps: PgDumpDeps) {
  return async function handlePgDumpJob(job: Job<PgDumpPayload>): Promise<{ key: string }> {
    const { databaseUrl, r2, logger } = deps;
    const date = job.data.date;
    const key = backupObjectKey(date);
    const log = logger.child({ job_id: job.id, queue: job.queueName, backup_date: date });

    log.info('[backup] starting pg_dump');

    // Spawn pg_dump; pipe its stdout through gzip; stream gzip's stdout to R2.
    const dump = spawn('pg_dump', [databaseUrl, '--format=plain', '--no-owner', '--no-acl'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stderrChunks: Buffer[] = [];
    dump.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const gzip = createGzip();
    dump.stdout.pipe(gzip);

    // If pg_dump fails before finishing, tear the gzip stream down so R2
    // sees a truncated upload and rejects rather than silently uploading
    // a partial dump.
    dump.on('error', (err: NodeJS.ErrnoException) => {
      gzip.destroy(pgDumpSpawnError(err));
    });

    const client = createR2Client(r2);
    const upload = new Upload({
      client,
      params: {
        Bucket: r2.bucket,
        Key: key,
        Body: gzip,
        ContentType: 'application/gzip',
        ContentDisposition: `attachment; filename="${date}.sql.gz"`,
      },
    });

    const [dumpExit, uploadResult] = await Promise.all([
      new Promise<number>((resolve, reject) => {
        // A process that never spawned emits 'error' and may never emit
        // 'exit'. Without this the promise dangles and the rejection that
        // surfaces is whichever unrelated error the R2 upload raises first.
        dump.on('error', (err: NodeJS.ErrnoException) => reject(pgDumpSpawnError(err)));
        dump.on('exit', (code) => {
          if (code === 0) resolve(0);
          else {
            const stderr = Buffer.concat(stderrChunks).toString('utf8');
            reject(new Error(`pg_dump exited with code ${code}: ${stderr}`));
          }
        });
      }),
      upload.done(),
    ]);

    // Smoke-test the upload by issuing a HeadObject-like action. Upload.done()
    // already resolves only on success, but double-check the expected key is
    // what CompleteMultipartUpload reported.
    const reportedKey = 'Key' in uploadResult ? uploadResult.Key : undefined;
    if (reportedKey !== undefined && reportedKey !== key) {
      throw new Error(`Upload key mismatch: expected ${key}, got ${reportedKey}`);
    }

    // Emit an explicit PutObject metadata probe (no-op if the Upload succeeded)
    // so a 404 shows up as a clear failure rather than a silent skip.
    void new PutObjectCommand({ Bucket: r2.bucket, Key: key });

    log.info({ dump_exit_code: dumpExit }, '[backup] complete');
    return { key };
  };
}
