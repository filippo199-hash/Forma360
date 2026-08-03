/**
 * Offline mutation queue (PF-10).
 *
 * The inspection conduct flow has had localStorage resilience since Phase 2;
 * this generalises the idea for the other field flows the review called out
 * as online-only: fire logbook entries, COSHH point-of-work assessments and
 * permit acceptance.
 *
 * Design:
 *   - a queued item carries the mutation `kind` + its exact tRPC input;
 *   - fire / COSHH payloads MUST include a `clientRequestId` — the server
 *     dedupes on it, so a retry after an ambiguous network failure can
 *     never double-record (migration 0066);
 *   - permit acceptance is naturally idempotent (accepting an already
 *     active permit fails cleanly), so a server rejection drops the item;
 *   - `OfflineQueueFlusher` (offline-queue-flusher.tsx) drains the queue on
 *     mount, on the `online` event and on an interval, executing through
 *     typed tRPC mutations. Network failures keep the item; server
 *     rejections drop it (the server said no — retrying forever would be
 *     wrong) and surface a toast.
 *
 * localStorage is per-browser, so the queue survives reloads and app
 * restarts — the common "recorded the alarm test in the basement, walked
 * back into signal" journey.
 */

export type OfflineKind = 'fire-log-entry' | 'coshh-pow' | 'permit-accept';

export interface OfflineItem {
  id: string;
  kind: OfflineKind;
  payload: Record<string, unknown>;
  queuedAt: string;
  attempts: number;
}

const STORAGE_KEY = 'forma360.offline-queue.v1';
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function readQueue(): OfflineItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OfflineItem[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: OfflineItem[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota/private-mode failure: nothing we can do — the caller already
    // showed the user an error path.
  }
  emit();
}

export function enqueueOffline(kind: OfflineKind, payload: Record<string, unknown>): void {
  const item: OfflineItem = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };
  writeQueue([...readQueue(), item]);
}

export function removeOfflineItem(id: string): void {
  writeQueue(readQueue().filter((i) => i.id !== id));
}

export function bumpAttempts(id: string): void {
  writeQueue(readQueue().map((i) => (i.id === id ? { ...i, attempts: i.attempts + 1 } : i)));
}

/** Subscribe to queue changes (React: useSyncExternalStore). */
export function subscribeOfflineQueue(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent): void => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function offlineQueueCount(): number {
  return readQueue().length;
}

/**
 * Was this mutation failure a connectivity problem (queue-worthy) rather
 * than a server rejection (surface to the user)? tRPC wraps fetch failures
 * in a TRPCClientError whose cause is a TypeError with no data/shape.
 */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (err instanceof Error) {
    const anyErr = err as Error & { data?: unknown; shape?: unknown };
    if (anyErr.data === undefined && anyErr.shape === undefined) {
      const msg = err.message.toLowerCase();
      return (
        msg.includes('fetch failed') ||
        msg.includes('failed to fetch') ||
        msg.includes('network') ||
        msg.includes('load failed')
      );
    }
  }
  return false;
}
