'use client';

/**
 * Per-user notification email toggles (platform HSE review PF-23). A
 * disabled toggle silences the EMAIL only — in-app bell rows are always
 * written, so muting can never hide information.
 */
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { trpc } from '../../lib/trpc/client';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';
import { Skeleton } from '../ui/skeleton';

export function NotificationPrefs() {
  const t = useTranslations('notifications.prefs');
  const utils = trpc.useUtils();
  const prefsQuery = trpc.notifications.prefs.useQuery();
  const setPref = trpc.notifications.setPref.useMutation({
    onSuccess: () => void utils.notifications.prefs.invalidate(),
    onError: () => toast.error(t('saveError')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </CardHeader>
      <CardContent>
        {prefsQuery.isLoading || prefsQuery.data === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <ul className="divide-y">
            {prefsQuery.data.keys.map((key) => {
              const enabled = prefsQuery.data.prefs[key] !== false;
              return (
                <li key={key} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm">{t(`keys.${key}` as never)}</span>
                  <Switch
                    checked={enabled}
                    disabled={setPref.isPending}
                    onCheckedChange={(next) => setPref.mutate({ key, enabled: next })}
                    aria-label={t(`keys.${key}` as never)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
