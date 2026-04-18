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
 */
import { signRenderToken } from './hmac';
import {
  loadInspectionSnapshot,
  hashInspectionSnapshot,
  type InspectionRenderSnapshot,
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
   * undefined and the real chromium launch path runs.
   */
  puppeteerRender?: (input: { url: string }) => Promise<Uint8Array>;
  /**
   * Optional logger hook — kept loose so we don't drag pino-types
   * into a package that runs in edge / browser contexts too.
   */
  onLog?: (event: { level: 'warn' | 'info'; msg: string }) => void;
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

  const bytes = await renderPdfBytes(deps, snap);

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

/**
 * Actually produce the PDF bytes. Tries the injected override first,
 * then falls back to chromium if available, then to a stub.
 */
async function renderPdfBytes(
  deps: RenderDeps,
  snap: InspectionRenderSnapshot,
): Promise<Uint8Array> {
  if (deps.puppeteerRender !== undefined) {
    const url = buildRenderUrl(deps, snap.inspection.id);
    return deps.puppeteerRender({ url });
  }

  try {
    return await renderWithChromium(deps, snap);
  } catch (err) {
    deps.onLog?.({
      level: 'warn',
      msg: `PDF render falling back to stub: ${err instanceof Error ? err.message : String(err)}`,
    });
    return renderStubPdf(snap);
  }
}

/**
 * Launch chromium via `puppeteer-core` + `@sparticuz/chromium` if both
 * are available. Both are optionalDependencies so installs on machines
 * without the chromium toolchain don't fail — we throw a descriptive
 * Error and the caller falls back to the stub path.
 */
async function renderWithChromium(
  deps: RenderDeps,
  snap: InspectionRenderSnapshot,
): Promise<Uint8Array> {
  // Dynamic import keeps the render package importable on platforms
  // where these can't install (e.g. pglite test runs).
  // `String(...)` on the specifier stops bundlers from trying to resolve
  // it at build time — we really do mean a runtime require.
  const puppeteerMod = await dynImport('puppeteer-core').catch(() => null);
  const chromiumMod = await dynImport('@sparticuz/chromium').catch(() => null);
  if (puppeteerMod === null || chromiumMod === null) {
    throw new Error('puppeteer-core or @sparticuz/chromium not installed');
  }

  const puppeteer = (puppeteerMod as { default?: unknown }).default ?? puppeteerMod;
  const chromium = (chromiumMod as { default?: unknown }).default ?? chromiumMod;

  // We only use a narrow slice of each module's surface; `as`-cast to
  // the local types here is the proven-boundary exception CLAUDE.md
  // allows. (Typing these modules fully would drag in their @types.)
  interface PuppeteerSlice {
    launch: (opts: unknown) => Promise<{
      newPage: () => Promise<{
        goto: (url: string, opts: unknown) => Promise<unknown>;
        pdf: (opts: unknown) => Promise<Buffer>;
      }>;
      close: () => Promise<void>;
    }>;
  }
  interface ChromiumSlice {
    args: string[];
    executablePath: () => Promise<string>;
  }
  const p = puppeteer as PuppeteerSlice;
  const c = chromium as ChromiumSlice;

  const browser = await p.launch({
    args: c.args,
    executablePath: await c.executablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(buildRenderUrl(deps, snap.inspection.id), {
      waitUntil: 'networkidle0',
      timeout: 30_000,
    });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' },
    });
    return new Uint8Array(buf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Indirection so the "not installed" error reads cleanly. A plain
 * dynamic-import of a missing specifier would throw at the call site.
 */
async function dynImport(specifier: string): Promise<unknown> {
  return (await Function('s', 'return import(s)')(specifier)) as unknown;
}

function buildRenderUrl(deps: RenderDeps, inspectionId: string): string {
  const token = signRenderToken({
    secret: deps.renderSharedSecret,
    inspectionId,
  });
  const base = deps.appUrl.replace(/\/+$/, '');
  return `${base}/render/inspection/${inspectionId}?token=${encodeURIComponent(token)}`;
}

/**
 * Minimal valid PDF (1.4) carrying a single-page "Render engine not
 * configured — <title>" notice. Used on envs without chromium so the
 * rest of the UX (download button, R2 cache key flow) stays wired.
 */
function renderStubPdf(snap: InspectionRenderSnapshot): Uint8Array {
  const notice = `Render engine not configured - ${truncate(snap.inspection.title, 120)}`;
  return buildMinimalPdf(notice);
}

/** True when the bytes look like the stub we emit (not a real render). */
function isStub(bytes: Uint8Array): boolean {
  // Our stub is < 1500 bytes. A chromium render is at minimum tens of
  // kilobytes. This is a soft diagnostic, not a trust boundary.
  return bytes.length < 1500;
}

async function uploadPdf(
  deps: RenderDeps,
  input: { key: string; bytes: Uint8Array },
): Promise<void> {
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
    throw new Error(`R2 upload failed: ${res.status} ${res.statusText}`);
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
