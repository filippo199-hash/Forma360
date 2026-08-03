'use client';

/**
 * Drains the PF-10 offline mutation queue and shows a pending-count chip.
 *
 * Mounted once in the signed-in shell. Flush triggers: mount, the browser
 * `online` event, and a 30 s interval (connectivity events are unreliable
 * on mobile). Items execute through typed tRPC mutations so permissions,
 * brand gating and Zod validation all apply exactly as if the user had
 * been online.
 *
 * Outcome handling per item:
 *   - success            → remove, invalidate queries, success toast (once
 *     per drain);
 *   - network failure    → keep for the next pass;
 *   - server rejection   → remove + error toast (the server said no —
 *     silently retrying forever would fake success).
 */
import { CloudOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  bumpAttempts,
  isNetworkError,
  offlineQueueCount,
  readQueue,
  removeOfflineItem,
  subscribeOfflineQueue,
} from '../lib/offline-queue';
import { trpc } from '../lib/trpc/client';

const FLUSH_INTERVAL_MS = 30_000;

export function OfflineQueueFlusher() {
  const t = useTranslations('offline');
  const utils = trpc.useUtils();
  const pending = useSyncExternalStore(subscribeOfflineQueue, offlineQueueCount, () => 0);

  const fireEntry = trpc.fireSafety.logbook.recordEntry.useMutation();
  const coshhCreate = trpc.coshh.assessments.create.useMutation();
  const coshhUpdate = trpc.coshh.assessments.update.useMutation();
  const coshhAddControl = trpc.coshh.assessments.addControl.useMutation();
  const coshhPublish = trpc.coshh.assessments.publish.useMutation();
  const permitAccept = trpc.permits.accept.useMutation();
  const flushing = useRef(false);

  /**
   * A queued point-of-work assessment is a whole intent: create (deduped on
   * clientRequestId) → routes → controls → publish. If a previous replay
   * died mid-chain, the create dedupes and the rest re-applies; the worst
   * duplicate is a repeated control row — visible and editable, unlike a
   * silently lost assessment.
   */
  const replayCoshhPow = async (payload: Record<string, unknown>): Promise<void> => {
    const created = await coshhCreate.mutateAsync(payload['create'] as never);
    const routes = payload['routesOfExposure'];
    if (Array.isArray(routes) && routes.length > 0) {
      await coshhUpdate.mutateAsync({
        assessmentId: created.assessmentId,
        routesOfExposure: routes,
      } as never);
    }
    const controls = payload['controls'];
    if (Array.isArray(controls)) {
      for (const c of controls) {
        await coshhAddControl.mutateAsync({
          assessmentId: created.assessmentId,
          ...(c as Record<string, unknown>),
        } as never);
      }
    }
    await coshhPublish.mutateAsync({ assessmentId: created.assessmentId } as never);
  };

  const flush = useCallback(async () => {
    if (flushing.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const items = readQueue();
    if (items.length === 0) return;
    flushing.current = true;
    let delivered = 0;
    try {
      for (const item of items) {
        try {
          if (item.kind === 'fire-log-entry') {
            await fireEntry.mutateAsync(item.payload as never);
          } else if (item.kind === 'coshh-pow') {
            await replayCoshhPow(item.payload);
          } else {
            await permitAccept.mutateAsync(item.payload as never);
          }
          removeOfflineItem(item.id);
          delivered += 1;
        } catch (err) {
          if (isNetworkError(err)) {
            bumpAttempts(item.id);
            break; // still offline — stop the pass, keep the rest queued
          }
          removeOfflineItem(item.id);
          toast.error(t('itemRejected'));
        }
      }
    } finally {
      flushing.current = false;
    }
    if (delivered > 0) {
      toast.success(t('itemsDelivered', { count: delivered }));
      void utils.invalidate();
    }
  }, [fireEntry, replayCoshhPow, permitAccept, t, utils]);

  useEffect(() => {
    void flush();
    const onOnline = (): void => void flush();
    window.addEventListener('online', onOnline);
    const timer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
    };
  }, []);

  if (pending === 0) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 shadow-md dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <CloudOff className="h-3.5 w-3.5" aria-hidden="true" />
      {t('pendingChip', { count: pending })}
    </div>
  );
}

/** Registers the service worker (production only). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // Registration failure is non-fatal — the app works without it.
    });
  }, []);
  return null;
}
