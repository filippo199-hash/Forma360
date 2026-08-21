#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * ux-explorer — the walkthrough driver for docs/ux-walkthrough-playbook.md §6.
 *
 * One invocation = one batch of persona actions against a running app
 * instance. The browser profile persists between invocations (cookies,
 * localStorage), so a signed-in walkthrough spans many small steps: the
 * session looks at the screenshot + aria snapshot each step prints, writes
 * the next expectation line as the persona, and issues the next step.
 *
 * This is a walkthrough instrument, not a test runner: it has no
 * assertions, it never retries, and a failed action is a *data point*
 * (screenshot captured, non-zero exit) rather than a flake.
 *
 * Usage:
 *   node tools/ux-explorer/explore.mjs --session uxw1 \
 *     [--device desktop-1440|desktop-1280|phone-390] \
 *     [--offline] [--delay <ms>] [--headed] \
 *     --actions '<json array>' | --actions-file <path>
 *
 * Environment:
 *   UXW_BASE_URL      target app (default http://localhost:3000)
 *   UXW_WORK_DIR      profiles + screenshots root (default: system tmp)
 *   PLAYWRIGHT_CHROMIUM_PATH  explicit Chromium binary (same contract as
 *                             playwright.config.ts); otherwise probed from
 *                             PLAYWRIGHT_BROWSERS_PATH, then Playwright's own.
 *
 * Actions (executed in order; every step is logged):
 *   {"provision": {"scenarioId": "permit", "refinementId": "hotWork"}}
 *       POST /api/sandbox/create with a unique x-real-ip; cookie lands in
 *       the profile; navigates to the landing route. FreeHS builds only.
 *   {"goto": "/en/incidents"}         relative to UXW_BASE_URL
 *   {"click": "text=Report incident"} any Playwright selector
 *   {"fill": ["#email", "a@b.c"]}
 *   {"press": ["body", "Escape"]}
 *   {"select": ["select#site", "Main yard"]}
 *   {"check": "input[name=confirm]"}
 *   {"upload": ["input[type=file]", "/path/to/file.jpg"]}  setInputFiles
 *   {"waitFor": "text=Saved"}         bounded by --timeout (default 10s)
 *   {"waitMs": 500}                   hard pause (max 5000)
 *   {"back": true}
 *   {"reload": true}
 *   {"offline": true|false}           mid-batch network toggle (world W5)
 *   {"screenshot": "after-submit"}    named screenshot
 *
 * Every invocation ends with: final URL, title, an aria snapshot of the
 * page, and the list of screenshots written this step.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require_ = createRequire(join(repoRoot, 'apps/web/package.json'));
const { chromium, devices } = require_('@playwright/test');

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
function flag(name) {
  return args.includes(`--${name}`);
}
function opt(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}

const session = opt('session', null);
if (session === null || !/^[a-z0-9-]+$/.test(session)) {
  console.error('--session <name> is required (lowercase slug); it names the persistent profile.');
  process.exit(2);
}
const device = opt('device', 'desktop-1440');
const delayMs = Number(opt('delay', '0'));
const actionTimeout = Number(opt('timeout', '10000'));
const baseURL = process.env.UXW_BASE_URL ?? 'http://localhost:3000';
const workDir = process.env.UXW_WORK_DIR ?? join(os.tmpdir(), 'ux-explorer');

const actionsRaw = opt('actions', null);
const actionsFile = opt('actions-file', null);
let actions;
try {
  actions = JSON.parse(
    actionsFile !== null ? readFileSync(actionsFile, 'utf8') : (actionsRaw ?? '[]'),
  );
} catch (err) {
  console.error(`Could not parse actions JSON: ${err.message}`);
  process.exit(2);
}
if (!Array.isArray(actions) || actions.length === 0) {
  console.error('Provide a non-empty JSON array via --actions or --actions-file.');
  process.exit(2);
}

// ---------------------------------------------------------- device presets
const presets = {
  'desktop-1440': { viewport: { width: 1440, height: 900 } },
  'desktop-1280': { viewport: { width: 1280, height: 800 } },
  // P3/P4's phone. Playwright's iPhone descriptor carries UA, touch,
  // scale factor; the explicit viewport pins the playbook's 390×844.
  'phone-390': { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
};
const preset = presets[device];
if (preset === undefined) {
  console.error(`Unknown --device "${device}". One of: ${Object.keys(presets).join(', ')}`);
  process.exit(2);
}

// ------------------------------------------------------- chromium binary
function chromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH !== undefined)
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root !== undefined && existsSync(root)) {
    // Managed layouts vary: /opt/pw-browsers/chromium, chromium-<rev>/chrome-linux/chrome…
    const direct = join(root, 'chromium');
    if (existsSync(direct) && !isDir(direct)) return direct;
    for (const entry of readdirSync(root)) {
      for (const candidate of [
        join(root, entry, 'chrome-linux', 'chrome'),
        join(root, entry, 'chrome-linux', 'headless_shell'),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined; // let Playwright resolve its own registry
}
function isDir(p) {
  try {
    return readdirSync(p) !== null;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ provision ip
// Same trick as apps/web/e2e/fixtures/sandbox.ts: the create endpoint
// rate-limits 5/hour per x-real-ip, so each provision presents a unique
// private address.
function uniqueClientIp() {
  const octet = () => 1 + Math.floor(Math.random() * 253);
  return `10.${100 + (octet() % 100)}.${octet()}.${octet()}`;
}

// ----------------------------------------------------------------- main
const profileDir = join(workDir, 'profiles', session);
const shotsDir = join(workDir, 'shots', session);
mkdirSync(profileDir, { recursive: true });
mkdirSync(shotsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let shotIndex = 0;
const shotsWritten = [];

const context = await chromium.launchPersistentContext(profileDir, {
  headless: !flag('headed'),
  baseURL,
  ...preset,
  ...(chromiumExecutable() !== undefined ? { executablePath: chromiumExecutable() } : {}),
});
context.setDefaultTimeout(actionTimeout);
const page = context.pages()[0] ?? (await context.newPage());

// The profile persists cookies, not the open page: restore the previous
// invocation's URL so a batch can pick up mid-flow without a leading goto.
const lastUrlFile = join(profileDir, 'last-url.txt');
const firstKind = Object.keys(actions[0])[0];
if (firstKind !== 'goto' && firstKind !== 'provision' && existsSync(lastUrlFile)) {
  const lastUrl = readFileSync(lastUrlFile, 'utf8').trim();
  if (lastUrl.startsWith('http')) {
    console.log(`resuming at ${lastUrl}`);
    await page.goto(lastUrl);
  }
}

if (flag('offline')) await context.setOffline(true);
if (delayMs > 0) {
  await context.route('**', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.continue();
  });
}

async function shoot(label) {
  shotIndex += 1;
  const file = join(shotsDir, `${stamp}-${String(shotIndex).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shotsWritten.push(file);
  return file;
}

async function run(action, i) {
  const [kind] = Object.keys(action);
  const value = action[kind];
  console.log(`step ${i + 1}/${actions.length}: ${kind} ${JSON.stringify(value).slice(0, 120)}`);
  switch (kind) {
    case 'provision': {
      const res = await context.request.post('/api/sandbox/create', {
        data: value,
        headers: { 'x-real-ip': uniqueClientIp() },
      });
      if (res.status() === 404)
        throw new Error('sandbox create 404 — target is not a FreeHS build (brand.offersSandbox)');
      if (!res.ok()) throw new Error(`sandbox create ${res.status()}: ${await res.text()}`);
      const body = await res.json();
      console.log(`  provisioned, landing: ${body.landingPath}`);
      await page.goto(`/en${body.landingPath}`);
      return;
    }
    case 'goto':
      await page.goto(value);
      return;
    case 'click':
      await page.locator(value).first().click();
      return;
    case 'fill':
      await page.locator(value[0]).first().fill(value[1]);
      return;
    case 'press':
      await page.locator(value[0]).first().press(value[1]);
      return;
    case 'select':
      await page.locator(value[0]).first().selectOption({ label: value[1] });
      return;
    case 'check':
      await page.locator(value).first().check();
      return;
    case 'upload':
      await page.locator(value[0]).first().setInputFiles(value[1]);
      return;
    case 'waitFor':
      await page.locator(value).first().waitFor();
      return;
    case 'waitMs':
      await new Promise((r) => setTimeout(r, Math.min(Number(value), 5000)));
      return;
    case 'back':
      await page.goBack();
      return;
    case 'reload':
      await page.reload();
      return;
    case 'offline':
      await context.setOffline(Boolean(value));
      return;
    case 'screenshot':
      console.log(`  saved ${await shoot(value)}`);
      return;
    default:
      throw new Error(`unknown action kind "${kind}"`);
  }
}

let failed = false;
for (const [i, action] of actions.entries()) {
  try {
    await run(action, i);
  } catch (err) {
    failed = true;
    console.error(
      `FAILED at step ${i + 1} (${Object.keys(action)[0]}): ${err.message.split('\n')[0]}`,
    );
    try {
      console.error(`  failure screenshot: ${await shoot('FAILED')}`);
    } catch {
      /* page may be gone */
    }
    break;
  }
}

// ------------------------------------------------- end-of-step state dump
// Registers load client-side after hydration, so a dump taken straight
// after the last action photographs skeletons. A bounded quiet-wait first;
// the cap (not a hard wait) keeps long-polling pages from hanging the step.
await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
try {
  console.log('---');
  console.log(`url:   ${page.url()}`);
  console.log(`title: ${await page.title().catch(() => '(unavailable)')}`);
  console.log(`shot:  ${await shoot('end')}`);
  const aria = await page.locator('body').ariaSnapshot();
  const MAX = 12000;
  console.log('--- aria snapshot ---');
  console.log(
    aria.length > MAX ? `${aria.slice(0, MAX)}\n… (${aria.length - MAX} chars truncated)` : aria,
  );
} catch (err) {
  console.error(`state dump failed: ${err.message.split('\n')[0]}`);
}

try {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(lastUrlFile, page.url());
} catch {
  /* best-effort */
}
await context.close();
process.exit(failed ? 1 : 0);
