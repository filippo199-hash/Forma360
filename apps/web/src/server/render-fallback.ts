/**
 * A short-lived, in-process holding area for rendered documents whose
 * object-store upload failed.
 *
 * Why this exists. Every export route does the same three things: call a
 * tRPC procedure that renders the document and uploads it to R2, ask the
 * store for a signed download URL, and 302 the browser at it. When the
 * store is unreachable the first step throws and the route returns a
 * 500 — so a document that rendered perfectly well never reaches the
 * person who asked for it. A practitioner review put it plainly: "a
 * record I can't get off the screen isn't a record, it's a screen." All
 * six export endpoints were dead from one bad credential.
 *
 * The renderer now hands the bytes here instead of throwing, and the
 * route serves them directly. The download still works; only the cache
 * is lost, which is what a cache losing is supposed to cost.
 *
 * Deliberate properties:
 *
 *   - **Same process.** The route builds a tRPC caller in-process, so the
 *     dependency closure that renders and this module are the same
 *     module instance. Nothing crosses a network boundary.
 *   - **Bounded.** At most {@link MAX_ENTRIES} documents and
 *     {@link MAX_TOTAL_BYTES} in total, evicting oldest-first, so a
 *     sustained outage cannot turn a degraded export path into an OOM.
 *   - **Single-use and short-lived.** An entry is deleted when it is
 *     taken, and expires after {@link TTL_MS} regardless. These bytes
 *     are the tail of one request, not a second storage tier — anything
 *     that wants them later should get a fixed object store instead.
 *
 * This is a degradation path, not a replacement for R2. Attachments
 * still genuinely need durable storage: a photograph has to survive the
 * request that uploaded it, and a re-render cannot reconstruct it.
 */

const MAX_ENTRIES = 32;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const TTL_MS = 2 * 60 * 1000;

interface Entry {
  bytes: Uint8Array;
  storedAt: number;
}

/** Insertion-ordered, which is what makes oldest-first eviction a shift. */
const entries = new Map<string, Entry>();
let totalBytes = 0;

function drop(key: string): void {
  const existing = entries.get(key);
  if (existing === undefined) return;
  totalBytes -= existing.bytes.length;
  entries.delete(key);
}

function evictExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (now - entry.storedAt > TTL_MS) drop(key);
  }
}

/**
 * Hold a rendered document whose upload failed. Wired into the render
 * dependencies as `onUploadFailure`.
 */
export function holdRenderedBytes(input: { key: string; bytes: Uint8Array }): void {
  const now = Date.now();
  evictExpired(now);
  drop(input.key);

  // A single document larger than the whole budget is not worth
  // evicting everything else for; let the route fall through to the
  // signed URL and fail honestly rather than pretend.
  if (input.bytes.length > MAX_TOTAL_BYTES) return;

  entries.set(input.key, { bytes: input.bytes, storedAt: now });
  totalBytes += input.bytes.length;

  while (entries.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    const oldest = entries.keys().next();
    if (oldest.done === true) break;
    drop(oldest.value);
  }
}

/**
 * Take the held bytes for a storage key, if any. Removes the entry —
 * one download per failed upload; a second attempt re-renders.
 */
export function takeRenderedBytes(key: string): Uint8Array | null {
  evictExpired(Date.now());
  const entry = entries.get(key);
  if (entry === undefined) return null;
  drop(key);
  return entry.bytes;
}

/** Test seam — not used in production paths. */
export function __resetRenderFallback(): void {
  entries.clear();
  totalBytes = 0;
}
