/**
 * PDF renderer. Phase 2 PR 31.
 *
 * See ADR 0008: the render path launches headless chromium, navigates
 * to `${appUrl}/render/inspection/${inspectionId}?token=...` where the
 * Next server-side-renders the print layout, and prints to PDF. The
 * artefact is cached in R2 under
 * `<tenantId>/inspections/<inspectionId>/pdf-<sha256>.pdf` keyed on
 * {@link hashInspectionSnapshot} — a stable inspection re-renders to
 * the same key.
 *
 * When chromium can't be launched (dev machines, CI, restricted prod
 * environments), {@link renderInspectionPdf} ships a stub PDF
 * (valid %PDF-1.4) so the share-link / Word halves of the feature ship
 * and tests stay deterministic. A misconfigured prod deploy logs a
 * warning on the stub path.
 *
 * NR-07: chromium is a process-wide singleton (one browser, a
 * `newPage()` per render) and every render passes through a small
 * in-process semaphore ({@link RENDER_CONCURRENCY} slots). The renderer
 * used to launch a fresh browser per render with no bound, so a burst
 * of concurrent exports — each ~150-300 MB of chromium plus a self-HTTP
 * request back into the same web container — could exhaust the
 * container's memory, at which point the platform edge 503'd everything
 * in flight, including unrelated `?_rsc=` prefetches.
 */
import { execSync } from 'node:child_process';
import { signRenderToken } from './hmac';
import { objectStoreUploadError } from '@forma360/shared/object-store-error';
import {
  loadDashboardSnapshot,
  hashDashboardSnapshot,
  loadDrillSnapshot,
  hashDrillSnapshot,
  loadFraSnapshot,
  hashFraSnapshot,
  loadIncidentSnapshot,
  loadRamsSnapshot,
  hashRamsSnapshot,
  hashIncidentSnapshot,
  loadInspectionSnapshot,
  hashInspectionSnapshot,
  loadRiskAssessmentSnapshot,
  hashRiskAssessmentSnapshot,
  loadPermitSnapshot,
  hashPermitSnapshot,
} from './snapshot';
import type { Database } from '@forma360/db/client';
import type { Storage } from '@forma360/shared/storage';

export interface RenderDeps {
  db: Database;
  storage: Storage;
  /**
   * Public base URL of the web app. The renderer navigates
   * `${appUrl}/render/inspection/<id>?token=...` to rasterise. For
   * tests / stubs this can be any string; only chromium actually
   * dereferences it.
   */
  appUrl: string;
  /** HMAC secret for the internal render-route token (RENDER_SHARED_SECRET). */
  renderSharedSecret: string;
  /**
   * Optional hook for tests. When provided, skips Puppeteer entirely
   * and hands back the resolved bytes. Production wiring leaves this
   * undefined and the real chromium launch path runs. The render
   * semaphore still applies to this hook, so concurrency tests can
   * exercise the cap without a browser.
   */
  puppeteerRender?: (input: { url: string }) => Promise<Uint8Array>;
  /**
   * Optional browser factory for tests: replaces the puppeteer-core
   * dynamic import + executable probe while still exercising the shared
   * browser singleton and relaunch-on-disconnect path (NR-07).
   * Production wiring leaves this undefined.
   */
  chromiumLaunch?: () => Promise<ChromiumBrowser>;
  /**
   * Optional logger hook — kept loose so we don't drag pino-types
   * into a package that runs in edge / browser contexts too.
   */
  onLog?: (event: { level: 'warn' | 'info'; msg: string }) => void;
  /**
   * Called with the rendered bytes when the object-store upload fails.
   *
   * The store is a CACHE and a delivery mechanism, not the source of
   * truth: by the time it is written the document has already been
   * rendered and is sitting in memory. Throwing away a finished
   * inspection report because a cache write 403'd is the wrong failure
   * mode — and it is not hypothetical. A misconfigured R2 credential
   * took out all six export endpoints at once, and the practitioner
   * reviewing the product could not get a single record off the screen:
   * "a record I can't get off the screen isn't a record, it's a screen."
   *
   * The web layer stashes these bytes briefly so the download route can
   * serve them directly instead of redirecting to a signed URL that
   * would also fail. Leave undefined and the old behaviour returns:
   * the upload error propagates.
   */
  onUploadFailure?: (input: { key: string; bytes: Uint8Array; error: string }) => void;
}

export interface RenderResult {
  /** R2 object key where the artefact lives. */
  key: string;
  /** Byte length of the artefact — callers don't need to re-read. */
  bytes: number;
  /** True when we rendered fresh, false when the cache already had it. */
  cached: boolean;
  /**
   * True when the renderer fell back to the "engine not configured"
   * stub. Production deploys should treat this as a misconfiguration.
   */
  stub: boolean;
}

/**
 * Render an inspection to PDF, caching by content hash. Returns the R2
 * key; callers use {@link Storage.getSignedDownloadUrl} to hand a
 * short-lived URL to the browser.
 */
export async function renderInspectionPdf(
  deps: RenderDeps,
  input: { tenantId: string; inspectionId: string },
): Promise<RenderResult> {
  const snap = await loadInspectionSnapshot(deps.db, input);
  if (snap === null) {
    throw new Error(`Inspection not found: ${input.inspectionId}`);
  }
  const hash = hashInspectionSnapshot(snap);
  const key = pdfObjectKey(input.tenantId, input.inspectionId, hash);

  // Cache lookup is intentionally a soft check — `getSignedDownloadUrl`
  // does not surface existence, so we optimistically ask to upload and
  // let R2 overwrite. For a content-hash cache the bytes are identical
  // by construction, so overwrite is safe. Real HEAD probes can be added
  // later without a schema change.

  const bytes = await renderPdfBytes(deps, {
    url: buildRenderUrl(deps, 'inspection', snap.inspection.id),
    stubTitle: snap.inspection.title,
  });

  await uploadPdf(deps, { key, bytes });

  return {
    key,
    bytes: bytes.length,
    cached: false,
    stub: isStub(bytes),
  };
}

/**
 * Render a risk assessment to PDF (FreeHS module B1), caching by content
 * hash — same pipeline as inspections, different print route. Used by the
 * "Share via Heads Up" flow to attach the assessment record.
 */
export async function renderRiskAssessmentPdf(
  deps: RenderDeps,
  input: { tenantId: string; assessmentId: string },
): Promise<RenderResult> {
  const snap = await loadRiskAssessmentSnapshot(deps.db, input);
  if (snap === null) {
    throw new Error(`Risk assessment not found: ${input.assessmentId}`);
  }
  const hash = hashRiskAssessmentSnapshot(snap);
  const key = `${input.tenantId}/risk-assessments/${input.assessmentId}/pdf-${hash}.pdf`;

  const bytes = await renderPdfBytes(deps, {
    url: buildRenderUrl(deps, 'risk-assessment', snap.assessment.id),
    stubTitle: snap.assessment.title,
  });

  await uploadPdf(deps, { key, bytes });

  return {
    key,
    bytes: bytes.length,
    cached: false,
    stub: isStub(bytes),
  };
}

/**
 * Render a permit to PDF (FreeHS module B3, HSE review PW-6) — the
 * postable/filable record: preconditions, evidence, signatures, timeline.
 * Same pipeline as risk assessments, different print route.
 */
export async function renderPermitPdf(
  deps: RenderDeps,
  input: { tenantId: string; permitId: string },
): Promise<RenderResult> {
  const snap = await loadPermitSnapshot(deps.db, input);
  if (snap === null) {
    throw new Error(`Permit not found: ${input.permitId}`);
  }
  const hash = hashPermitSnapshot(snap);
  const key = `${input.tenantId}/permits/${input.permitId}/pdf-${hash}.pdf`;

  const bytes = await renderPdfBytes(deps, {
    url: buildRenderUrl(deps, 'permit', snap.permit.id),
    stubTitle: snap.permit.title,
  });

  await uploadPdf(deps, { key, bytes });

  return {
    key,
    bytes: bytes.length,
    cached: false,
    stub: isStub(bytes),
  };
}

/**
 * Render a fire risk assessment to PDF (FreeHS module B4, HSE review
 * FS-5) — the primary fire-safety document, exportable at last. Same
 * pipeline as permits, different print route.
 */
export async function renderFraPdf(
  deps: RenderDeps,
  input: { tenantId: string; fraId: string },
): Promise<RenderResult> {
  const snap = await loadFraSnapshot(deps.db, input);
  if (snap === null) {
    throw new Error(`Fire risk assessment not found: ${input.fraId}`);
  }
  const hash = hashFraSnapshot(snap);
  const key = `${input.tenantId}/fire-safety/${input.fraId}/pdf-${hash}.pdf`;

  const bytes = await renderPdfBytes(deps, {
    url: buildRenderUrl(deps, 'fra', snap.fra.id),
    stubTitle: snap.fra.title,
  });

  await uploadPdf(deps, { key, bytes });

  return {
    key,
    bytes: bytes.length,
    cached: false,
    stub: isStub(bytes),
  };
}

/**
 * Render a fire drill record to PDF (FreeHS module B4) — the drill as a
 * filable logbook page: evacuation time, muster roll, lessons learned.
 * Same pipeline as FRAs, different print route.
 */
export async function renderDrillPdf(
  deps: RenderDeps,
  input: { tenantId: string; drillId: string },
): Promise<RenderResult> {
  const snap = await loadDrillSnapshot(deps.db, input);
  if (snap === null) {
    throw new Error(`Fire drill not found: ${input.drillId}`);
  }
  const hash = hashDrillSnapshot(snap);
  const key = `${input.tenantId}/fire-safety/${input.drillId}/drill-pdf-${hash}.pdf`;

  const bytes = await renderPdfBytes(deps, {
    url: buildRenderUrl(deps, 'drill', snap.drill.id),
    stubTitle: `Fire drill - ${snap.building.name}`,
  });

  await uploadPdf(deps, { key, bytes });

  return {
    key,
    bytes: bytes.length,
    cached: false,
    stub: isStub(bytes),
  };
}

/**
 * Render an incident report to PDF (FreeHS module B5) — the full record
 * + investigation + signatures in one document: the insurer pack and
 * the auditor's clause-10.2 sample. Same pipeline as permits/FRAs.
 */
export async function renderIncidentPdf(
  deps: RenderDeps,
  input: { tenantId: string; incidentId: string },
): Promise<RenderResult> {
  const snap = await loadIncidentSnapshot(deps.db, input);
  if (snap === null) {
    throw new Error(`Incident not found: ${input.incidentId}`);
  }
  const hash = hashIncidentSnapshot(snap);
  const key = `${input.tenantId}/incidents/${input.incidentId}/pdf-${hash}.pdf`;

  const bytes = await renderPdfBytes(deps, {
    url: buildRenderUrl(deps, 'incident', snap.incident.id),
    stubTitle: snap.incident.title,
  });

  await uploadPdf(deps, { key, bytes });

  return {
    key,
    bytes: bytes.length,
    cached: false,
    stub: isStub(bytes),
  };
}

/**
 * Render a RAMS pack version to PDF (FreeHS module B6) — the combined
 * artefact the client receives and the crew is briefed from: job
 * context, the sequenced method statement with its hold points, the
 * bound risk assessments and COSHH records, supporting documents, the
 * author attestation and the briefing register.
 *
 * Renders the FROZEN version row, so a pack issued at v1 always prints
 * as it was issued (RS-E07). Same pipeline as permits / FRAs / incidents.
 */
export async function renderRamsPdf(
  deps: RenderDeps,
  input: { tenantId: string; packId: string; packVersionId: string },
): Promise<RenderResult> {
  const snap = await loadRamsSnapshot(deps.db, {
    tenantId: input.tenantId,
    packVersionId: input.packVersionId,
  });
  if (snap === null) {
    throw new Error(`RAMS pack version not found: ${input.packVersionId}`);
  }
  const hash = hashRamsSnapshot(snap);
  const key = `${input.tenantId}/rams/${input.packId}/pdf-v${snap.version.versionNumber}-${hash}.pdf`;

  const bytes = await renderPdfBytes(deps, {
    url: buildRenderUrl(deps, 'rams', snap.version.id),
    stubTitle: snap.pack.title,
  });

  await uploadPdf(deps, { key, bytes });

  return {
    key,
    bytes: bytes.length,
    cached: false,
    stub: isStub(bytes),
  };
}

/**
 * Render a custom dashboard to PDF (ADR 0018) — the artefact scheduled
 * email delivery attaches and the toolbar download serves. The print
 * route re-executes every widget live at render time, so the same
 * cache key can carry fresher numbers on a later render; the key hashes
 * (spec + updatedAt + title) so an unchanged dashboard overwrites one
 * object instead of accreting a file per run. Same pipeline as the six
 * module renderers, different print route.
 */
export async function renderDashboardPdf(
  deps: RenderDeps,
  input: { tenantId: string; dashboardId: string },
): Promise<RenderResult> {
  const snap = await loadDashboardSnapshot(deps.db, input);
  if (snap === null) {
    throw new Error(`Dashboard not found: ${input.dashboardId}`);
  }
  const hash = hashDashboardSnapshot(snap);
  const key = `${input.tenantId}/dashboards/${input.dashboardId}/pdf-${hash}.pdf`;

  const bytes = await renderPdfBytes(deps, {
    url: buildRenderUrl(deps, 'dashboard', snap.dashboard.id),
    stubTitle: snap.dashboard.title,
  });

  await uploadPdf(deps, { key, bytes });

  return {
    key,
    bytes: bytes.length,
    cached: false,
    stub: isStub(bytes),
  };
}

/** Build the R2 object key for a given inspection + content hash. */
export function pdfObjectKey(tenantId: string, inspectionId: string, hash: string): string {
  return `${tenantId}/inspections/${inspectionId}/pdf-${hash}.pdf`;
}

// ---------------------------------------------------------------------------
// Chromium lifecycle (NR-07): one shared browser, bounded render concurrency.
// ---------------------------------------------------------------------------

/**
 * The narrow slice of Puppeteer's Page surface the renderer uses. Kept
 * structural so tests can supply fakes and so consumers never need
 * puppeteer's own types.
 */
export interface ChromiumPage {
  goto: (url: string, opts: unknown) => Promise<unknown>;
  pdf: (opts: unknown) => Promise<Uint8Array>;
  close: () => Promise<void>;
}

/** The narrow slice of Puppeteer's Browser surface the renderer uses. */
export interface ChromiumBrowser {
  newPage: () => Promise<ChromiumPage>;
  close: () => Promise<void>;
  /** puppeteer >= 22 exposes `connected`; older versions `isConnected()`. */
  connected?: boolean;
  isConnected?: () => boolean;
}

/**
 * NR-07: how many renders may hold a chromium page (and its self-HTTP
 * request back into this container) at once. Two keeps exports flowing
 * while capping the memory a burst of parallel exports can claim.
 */
export const RENDER_CONCURRENCY = 2;

let inFlightRenders = 0;
const renderSlotWaiters: Array<() => void> = [];

async function acquireRenderSlot(): Promise<void> {
  if (inFlightRenders < RENDER_CONCURRENCY) {
    inFlightRenders += 1;
    return;
  }
  // Queue is FIFO; the releasing render hands its slot straight to the
  // waiter, so `inFlightRenders` already accounts for it on resume.
  await new Promise<void>((resolve) => renderSlotWaiters.push(resolve));
}

function releaseRenderSlot(): void {
  const next = renderSlotWaiters.shift();
  if (next !== undefined) {
    next(); // slot transfers — the count is unchanged
    return;
  }
  inFlightRenders -= 1;
}

let sharedBrowser: Promise<ChromiumBrowser> | null = null;

/** Test-only: forget the shared browser so the next render relaunches. */
export function resetSharedBrowserForTests(): void {
  sharedBrowser = null;
}

function browserIsConnected(browser: ChromiumBrowser): boolean {
  if (typeof browser.connected === 'boolean') return browser.connected;
  if (typeof browser.isConnected === 'function') return browser.isConnected();
  // A fake without either signal is assumed healthy.
  return true;
}

/**
 * Resolve the process-wide browser, launching (or transparently
 * relaunching after a disconnect) as needed. The loop makes racing
 * callers converge on one live instance: whoever observes a dead or
 * failed browser clears the cache, and everyone re-checks.
 */
async function acquireBrowser(deps: RenderDeps): Promise<ChromiumBrowser> {
  for (;;) {
    const current = sharedBrowser;
    if (current === null) {
      const attempt =
        deps.chromiumLaunch !== undefined ? deps.chromiumLaunch() : launchChromium(deps);
      sharedBrowser = attempt;
      try {
        return await attempt;
      } catch (err) {
        // Never cache a failed launch — the next render retries (and the
        // caller falls back to the stub in the meantime).
        if (sharedBrowser === attempt) sharedBrowser = null;
        throw err;
      }
    }
    let browser: ChromiumBrowser | null = null;
    try {
      browser = await current;
    } catch {
      // The launching caller clears the cache in its own catch; loop.
    }
    if (browser !== null && browserIsConnected(browser)) return browser;
    if (sharedBrowser === current) sharedBrowser = null;
    // Best-effort cleanup of a disconnected instance's process handle.
    if (browser !== null) void browser.close().catch(() => undefined);
  }
}

/** RSS in MB, or 'n/a' where process.memoryUsage is unavailable (edge). */
function rssMb(): string {
  if (typeof process === 'undefined' || typeof process.memoryUsage !== 'function') return 'n/a';
  return `${Math.round(process.memoryUsage().rss / (1024 * 1024))}MB`;
}

/**
 * NR-07 instrumentation: rss + in-flight count at render start/end, so a
 * 503 window can be correlated with render load from the app logs alone.
 */
function logRenderPhase(deps: RenderDeps, phase: 'start' | 'end'): void {
  deps.onLog?.({
    level: 'info',
    msg: `pdf render ${phase}: in-flight ${inFlightRenders}/${RENDER_CONCURRENCY}, rss ${rssMb()}`,
  });
}

/**
 * Actually produce the PDF bytes. Tries the injected override first,
 * then falls back to chromium if available, then to a stub. Every path
 * runs inside the render semaphore.
 */
async function renderPdfBytes(
  deps: RenderDeps,
  input: { url: string; stubTitle: string },
): Promise<Uint8Array> {
  await acquireRenderSlot();
  logRenderPhase(deps, 'start');
  try {
    if (deps.puppeteerRender !== undefined) {
      return await deps.puppeteerRender({ url: input.url });
    }
    try {
      return await renderWithChromium(deps, input.url);
    } catch (err) {
      deps.onLog?.({
        level: 'warn',
        msg: `PDF render falling back to stub: ${err instanceof Error ? err.message : String(err)}`,
      });
      return renderStubPdf(input.stubTitle);
    }
  } finally {
    logRenderPhase(deps, 'end');
    releaseRenderSlot();
  }
}

/**
 * Render one page in the shared browser. The browser is a singleton
 * ({@link acquireBrowser}); each render only pays for a page, closed in
 * the finally so a throwing render can't leak tabs. If the browser died
 * mid-render this render falls back to the stub and the NEXT acquire
 * detects the disconnect and relaunches.
 */
async function renderWithChromium(deps: RenderDeps, url: string): Promise<Uint8Array> {
  const browser = await acquireBrowser(deps);
  const page = await browser.newPage();
  try {
    // 'load', not 'networkidle0' (NR-07): every /render/* page is a pure
    // server-component tree — verified: none of the eight print layouts
    // contains 'use client', hooks or client-side fetching (the dashboard
    // route renders widgets to static HTML/SVG server-side), their root
    // layout (app/render/layout.tsx) is a bare <html><body> with no global
    // CSS or webfonts, and every <img> (logos, attachment photos, signature
    // data URIs) sits in the initial server HTML without loading="lazy" —
    // all of which the window load event already waits for. networkidle0
    // added a mandatory 500 ms idle probe and held the self-request open
    // for the full 30 s timeout whenever any connection lingered.
    await page.goto(url, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' },
    });
    return new Uint8Array(buf);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Launch chromium via `puppeteer-core`. Two executable paths are tried
 * in order:
 *
 *   1. `@sparticuz/chromium` (optional dep) — pre-compiled binary for
 *      AWS Lambda / Amazon Linux 2. Works on serverless; NOT usable on
 *      nixpkgs-based Railway containers (wrong glibc).
 *   2. System chromium — path from `CHROMIUM_PATH` env var (if set) or
 *      `chromium` in PATH. Railway nixpacks installs `chromium` from
 *      nixpkgs so it is available as `chromium` in PATH on those nodes.
 *
 * `puppeteer-core` is a regular dependency so it is always present. If
 * even system chromium is missing the function throws and the caller
 * falls back to the stub path.
 */
async function launchChromium(deps: RenderDeps): Promise<ChromiumBrowser> {
  // Dynamic import keeps the render package importable on platforms
  // where the binary can't run (e.g. pglite unit-test runs).
  const puppeteerMod = await dynImport('puppeteer-core').catch(() => null);
  if (puppeteerMod === null) {
    throw new Error('puppeteer-core not installed');
  }

  const puppeteer = (puppeteerMod as { default?: unknown }).default ?? puppeteerMod;

  // We only use a narrow slice of each module's surface; `as`-cast to
  // the local types here is the proven-boundary exception CLAUDE.md
  // allows. (Typing these modules fully would drag in their @types.)
  interface PuppeteerSlice {
    launch: (opts: unknown) => Promise<ChromiumBrowser>;
  }
  const p = puppeteer as PuppeteerSlice;

  // --- Resolve executable path and args ---

  // Try @sparticuz/chromium first (for Lambda / serverless deploys).
  let executablePath: string;
  let browserArgs: string[];

  const chromiumMod = await dynImport('@sparticuz/chromium').catch(() => null);
  if (chromiumMod !== null) {
    interface ChromiumSlice {
      args: string[];
      executablePath: () => Promise<string>;
    }
    const c = ((chromiumMod as { default?: unknown }).default ?? chromiumMod) as ChromiumSlice;
    executablePath = await c.executablePath();
    browserArgs = c.args;
  } else {
    // Fall back to system chromium (Railway nixpacks / Docker / local dev).
    // CHROMIUM_PATH lets ops override the binary outright. Otherwise we must
    // hand Puppeteer an ABSOLUTE path — it does not resolve a bare command name
    // against PATH — and nixpacks installs chromium under a hash-based nix-store
    // path, so resolve it from PATH at runtime via `command -v`.
    executablePath = resolveSystemChromium();
    // --no-sandbox + --disable-setuid-sandbox are required in every
    // container environment (kernel user-namespaces are disabled).
    // --disable-dev-shm-usage avoids OOM when /dev/shm is small (< 64 MB),
    // which is the default on many Railway/Fly.io instances.
    browserArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ];
    deps.onLog?.({
      level: 'info',
      msg: `@sparticuz/chromium not available — using system chromium at ${executablePath}`,
    });
  }

  return p.launch({
    args: browserArgs,
    executablePath,
    headless: true,
  });
}

/**
 * Indirection so the "not installed" error reads cleanly. A plain
 * dynamic-import of a missing specifier would throw at the call site.
 */
async function dynImport(specifier: string): Promise<unknown> {
  return (await Function('s', 'return import(s)')(specifier)) as unknown;
}

/**
 * NR-07: the PATH probe shells out synchronously (`command -v` per
 * candidate), which blocked the event loop on EVERY render before the
 * browser became a singleton. The binary's location cannot change under
 * a running container, so resolve once and reuse.
 */
let cachedChromiumPath: string | null = null;

/**
 * Resolve an ABSOLUTE path to a system chromium binary. `CHROMIUM_PATH` wins;
 * otherwise probe PATH with `command -v` for the common binary names (nixpacks
 * installs `chromium` at a hash-based nix-store path, so a bare name won't do).
 * Returns `'chromium'` as a last resort so the caller's launch error is clear.
 */
function resolveSystemChromium(): string {
  if (cachedChromiumPath !== null) return cachedChromiumPath;
  cachedChromiumPath = probeSystemChromium();
  return cachedChromiumPath;
}

function probeSystemChromium(): string {
  const override = process.env['CHROMIUM_PATH'];
  if (override !== undefined && override.length > 0) return override;
  for (const name of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
    try {
      const resolved = execSync(`command -v ${name}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (resolved.length > 0) return resolved;
    } catch {
      // not on PATH — try the next candidate
    }
  }
  return 'chromium';
}

/**
 * Build the HMAC-tokened print-route URL. `kind` picks the route
 * (`/render/inspection/...` or `/render/risk-assessment/...`); the token
 * signs the subject id, whatever entity it belongs to.
 */
function buildRenderUrl(
  deps: RenderDeps,
  kind:
    | 'inspection'
    | 'risk-assessment'
    | 'permit'
    | 'fra'
    | 'drill'
    | 'incident'
    | 'rams'
    | 'dashboard',
  subjectId: string,
): string {
  const token = signRenderToken({
    secret: deps.renderSharedSecret,
    inspectionId: subjectId,
  });
  const base = deps.appUrl.replace(/\/+$/, '');
  return `${base}/render/${kind}/${subjectId}?token=${encodeURIComponent(token)}`;
}

/**
 * Minimal valid PDF (1.4) carrying a single-page "Render engine not
 * configured — <title>" notice. Used on envs without chromium so the
 * rest of the UX (download button, R2 cache key flow) stays wired.
 */
function renderStubPdf(title: string): Uint8Array {
  const notice = `Render engine not configured - ${truncate(title, 120)}`;
  return buildMinimalPdf(notice);
}

/** True when the bytes look like the stub we emit (not a real render). */
function isStub(bytes: Uint8Array): boolean {
  // Our stub is < 1500 bytes. A chromium render is at minimum tens of
  // kilobytes. This is a soft diagnostic, not a trust boundary.
  return bytes.length < 1500;
}

/**
 * Upload the artefact, or — when a caller has supplied
 * {@link RenderDeps.onUploadFailure} — hand the bytes back to it and
 * carry on. See that field for why a failed cache write must not
 * destroy a finished document.
 */
async function uploadPdf(
  deps: RenderDeps,
  input: { key: string; bytes: Uint8Array },
): Promise<void> {
  try {
    await putPdf(deps, input);
  } catch (err) {
    if (deps.onUploadFailure === undefined) throw err;
    const message = err instanceof Error ? err.message : String(err);
    deps.onLog?.({
      level: 'warn',
      msg: `object-store upload failed for ${input.key}; serving the render inline (${message})`,
    });
    deps.onUploadFailure({ key: input.key, bytes: input.bytes, error: message });
  }
}

async function putPdf(deps: RenderDeps, input: { key: string; bytes: Uint8Array }): Promise<void> {
  const url = await deps.storage.getSignedUploadUrl({
    key: input.key,
    contentType: 'application/pdf',
    expiresInSeconds: 60 * 5,
  });
  // fetch is ambient on Node 22 LTS and in every Next runtime.
  // The `body: Uint8Array` form is valid at runtime but Next's stricter
  // lib types demand a cast; local `@types` for render don't pull in
  // DOM's BodyInit so we cast through unknown.
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: input.bytes as unknown as ReadableStream,
  });
  if (!res.ok) {
    // The XML body names the cause; a bare 403 does not. See
    // object-store-error.ts.
    throw await objectStoreUploadError(res);
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '\u2026';
}

/**
 * Build a minimal but structurally-valid PDF 1.4 file carrying a single
 * line of text. Kept hand-rolled to avoid adding a native/optional
 * dependency to the stub path. The byte layout is the textbook
 * "hello world" PDF — catalog → pages → page → content stream — with
 * xref offsets calculated from the concrete byte positions.
 */
function buildMinimalPdf(text: string): Uint8Array {
  const safe = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    // content stream — one BT/ET block with Helvetica at 14pt
    (() => {
      const stream = `BT /F1 14 Tf 50 800 Td (${safe}) Tj ET`;
      return `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
    })(),
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  const header = '%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n';
  const enc = new TextEncoder();
  let offset = enc.encode(header).length;
  const offsets: number[] = [];
  const chunks: Uint8Array[] = [enc.encode(header)];
  for (const obj of objects) {
    offsets.push(offset);
    const bytes = enc.encode(obj);
    chunks.push(bytes);
    offset += bytes.length;
  }
  const xrefStart = offset;
  const lines: string[] = [];
  lines.push('xref');
  lines.push(`0 ${objects.length + 1}`);
  lines.push('0000000000 65535 f ');
  for (const o of offsets) {
    lines.push(`${o.toString().padStart(10, '0')} 00000 n `);
  }
  lines.push(
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
  );
  chunks.push(enc.encode(lines.join('\n')));

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
