#!/usr/bin/env node
/**
 * Dependency-advisory regression gate.
 *
 * There was no dependency surveillance in CI at all, which is how `next` came
 * to sit thirteen advisories behind a patch release its own caret range
 * already allowed.
 *
 * A plain `pnpm audit --audit-level high` cannot be the gate: this tree
 * currently carries advisories that are either not applicable (better-auth's
 * OAuth/OIDC issues, on a deployment that is email-OTP only) or have no
 * upstream fix (`xlsx`, whose maintainer left npm). A gate that always fails
 * gets deleted, and deleting it is worse than never adding it.
 *
 * So this gate is a RATCHET: it fails only on a high/critical advisory that is
 * not in the committed baseline. Adding a vulnerable dependency fails CI;
 * living with a known, written-down risk does not. When an advisory is fixed
 * it is reported as prunable, so the baseline shrinks over time instead of
 * quietly becoming a blanket exemption.
 *
 * Usage:
 *   node scripts/audit-gate.mjs           # gate (exit 1 on a new advisory)
 *   node scripts/audit-gate.mjs --update  # rewrite the baseline from reality
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, '..', '.github', 'audit-baseline.json');
const GATED_SEVERITIES = new Set(['high', 'critical']);

/** `pnpm audit` exits non-zero when it finds anything, so capture rather than throw. */
async function runAudit() {
  try {
    const { stdout } = await execFileAsync(
      'pnpm',
      ['audit', '--prod', '--json', '--ignore-registry-errors'],
      { cwd: join(HERE, '..'), maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout;
  } catch (err) {
    if (typeof err?.stdout === 'string' && err.stdout.length > 0) return err.stdout;
    throw err;
  }
}

function parseAdvisories(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A registry hiccup yields prose, not JSON. Do not silently pass.
    throw new Error(`pnpm audit did not return JSON:\n${raw.slice(0, 500)}`);
  }
  const out = new Map();
  for (const advisory of Object.values(parsed.advisories ?? {})) {
    if (!GATED_SEVERITIES.has(advisory.severity)) continue;
    const id = advisory.github_advisory_id ?? `pnpm-${advisory.id}`;
    out.set(id, {
      id,
      severity: advisory.severity,
      module: advisory.module_name,
      title: (advisory.title ?? '').slice(0, 120),
    });
  }
  return out;
}

function readBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    return parsed.accepted ?? {};
  } catch {
    return {};
  }
}

const found = parseAdvisories(await runAudit());
const update = process.argv.includes('--update');

if (update) {
  const accepted = {};
  for (const [id, a] of [...found].sort(([x], [y]) => x.localeCompare(y))) {
    accepted[id] = {
      module: a.module,
      severity: a.severity,
      title: a.title,
      // Filled in by hand. An entry with the placeholder still gates nothing,
      // but it reads as unexamined in review, which is the intent.
      reason: readBaseline()[id]?.reason ?? 'TODO: why is this accepted?',
    };
  }
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify(
      {
        $comment:
          'Known high/critical advisories, accepted deliberately. Each needs a reason. ' +
          'Regenerate with `node scripts/audit-gate.mjs --update`, then write the reasons.',
        accepted,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Baseline written with ${Object.keys(accepted).length} accepted advisories.`);
  process.exit(0);
}

const baseline = readBaseline();
const introduced = [...found.values()].filter((a) => baseline[a.id] === undefined);
const fixed = Object.keys(baseline).filter((id) => !found.has(id));

console.log(
  `Dependency audit: ${found.size} high/critical advisories, ${Object.keys(baseline).length} accepted in baseline.`,
);

if (fixed.length > 0) {
  console.log(
    `\n${fixed.length} baselined advisory/advisories no longer present — prune them from ` +
      `.github/audit-baseline.json:\n  ${fixed.join('\n  ')}`,
  );
}

if (introduced.length === 0) {
  console.log('\nNo new high or critical advisories. ✓');
  process.exit(0);
}

console.error(`\n${introduced.length} NEW high/critical advisory/advisories:\n`);
for (const a of introduced) {
  console.error(`  [${a.severity}] ${a.module} — ${a.title}\n    ${a.id}`);
}
console.error(
  '\nFix it (`pnpm update <pkg>` — the fix is often inside the existing range), or, if it is ' +
    'genuinely not applicable, run `node scripts/audit-gate.mjs --update` and write down why in ' +
    '.github/audit-baseline.json. Do not delete this gate.',
);
process.exit(1);
