'use client';

/**
 * Per-user notification preference table (settings → notifications).
 *
 * One row per catalogue kind, grouped by module, with an Email and an
 * In-app toggle per row — each user tunes exactly what reaches them and
 * how. Rows for brand-only modules are filtered by the active brand, so
 * Forma360 never shows FreeHS-only kinds. The server resolves defaults
 * and legacy keys into the effective matrix; this component only renders
 * it and writes one (kind, channel) cell at a time.
 */
import type {
  NotificationChannel,
  NotificationKind,
} from '@forma360/shared/notification-catalogue';
import {
  NOTIFICATION_GROUPS,
  notificationEventsForBrand,
} from '@forma360/shared/notification-catalogue';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { toast } from 'sonner';
import { activeBrand } from '../../lib/brand';
import { trpc } from '../../lib/trpc/client';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';
import { Skeleton } from '../ui/skeleton';

export function NotificationPrefs() {
  const t = useTranslations('notifications');
  const utils = trpc.useUtils();
  const prefsQuery = trpc.notifications.prefs.useQuery();
  const setPref = trpc.notifications.setPref.useMutation({
    // Optimistic: 52 switches sharing one pending flag would freeze the
    // whole table on every click.
    onMutate: async (input) => {
      await utils.notifications.prefs.cancel();
      const previous = utils.notifications.prefs.getData();
      utils.notifications.prefs.setData(undefined, (old) => {
        if (old === undefined) return old;
        const cell = old.matrix[input.kind];
        if (cell === undefined) return old;
        return {
          matrix: { ...old.matrix, [input.kind]: { ...cell, [input.channel]: input.enabled } },
        };
      });
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous !== undefined) {
        utils.notifications.prefs.setData(undefined, ctx.previous);
      }
      toast.error(t('prefs.saveError'));
    },
    onSettled: () => void utils.notifications.prefs.invalidate(),
  });

  const events = notificationEventsForBrand(activeBrand.id);
  const groups = NOTIFICATION_GROUPS.map((group) => ({
    group,
    events: events.filter((e) => e.group === group),
  })).filter((g) => g.events.length > 0);

  const toggle = (kind: NotificationKind, channel: NotificationChannel, enabled: boolean) =>
    setPref.mutate({ kind, channel, enabled });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('prefs.title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('prefs.subtitle')}</p>
      </CardHeader>
      <CardContent>
        {prefsQuery.data === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('prefs.eventColumn')}
                  </th>
                  <th scope="col" className="w-24 py-2 text-center font-medium">
                    {t('prefs.email')}
                  </th>
                  <th scope="col" className="w-24 py-2 text-center font-medium">
                    {t('prefs.inApp')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map(({ group, events: groupEvents }) => (
                  <Fragment key={group}>
                    <tr className="border-b bg-muted/40">
                      <th
                        scope="rowgroup"
                        colSpan={3}
                        className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {t(`prefs.groups.${group}` as never)}
                      </th>
                    </tr>
                    {groupEvents.map((event) => {
                      const cell = prefsQuery.data.matrix[event.kind] ?? {
                        email: true,
                        inapp: true,
                      };
                      return (
                        <tr key={event.kind} className="border-b last:border-b-0">
                          <td className="py-2.5 pr-4">{t(`kinds.${event.kind}` as never)}</td>
                          <td className="py-2.5 text-center">
                            <Switch
                              checked={cell.email}
                              onCheckedChange={(next) => toggle(event.kind, 'email', next)}
                              aria-label={`${t(`kinds.${event.kind}` as never)} — ${t('prefs.email')}`}
                            />
                          </td>
                          <td className="py-2.5 text-center">
                            <Switch
                              checked={cell.inapp}
                              onCheckedChange={(next) => toggle(event.kind, 'inapp', next)}
                              aria-label={`${t(`kinds.${event.kind}` as never)} — ${t('prefs.inApp')}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
