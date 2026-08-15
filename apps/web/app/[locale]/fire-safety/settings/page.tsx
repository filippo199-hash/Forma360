'use client';

/**
 * Fire-safety settings — currently one decision: which training
 * requirements count as a fire-marshal ticket (FS-X01).
 *
 * The reconciliation between `fire_marshals` and the training matrix
 * shipped inert on purpose: designating nothing keeps a tenant's marshals
 * exactly as they were. But `settings.setMarshalRequirements` had no UI at
 * all, so "inert" meant "unreachable", and the two registers went on
 * disagreeing with no way for an administrator to link them. That is the
 * RS-A1 failure mode — a procedure that exists and cannot be called — so
 * this page exists to close it.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ModuleHeader } from '../../../../src/components/module-header';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Checkbox } from '../../../../src/components/ui/checkbox';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';
import { trpc } from '../../../../src/lib/trpc/client';
import { toast } from 'sonner';

export default function FireSafetySettingsPage() {
  const t = useTranslations('fireSafety');
  const tCommon = useTranslations('common');
  const canManage = useHasPermission('fireSafety.manage');
  const onServerError = useServerErrorToast(t('saveError'));

  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.fireSafety.settings.get.useQuery();
  const { data: requirements, isLoading: loadingRequirements } =
    trpc.training.listRequirements.useQuery({ includeArchived: false });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  // Server value is the source of truth until the user touches the form.
  useEffect(() => {
    if (settings !== undefined && !dirty) {
      setSelected(new Set(settings.marshalRequirementIds));
    }
  }, [settings, dirty]);

  const save = trpc.fireSafety.settings.setMarshalRequirements.useMutation({
    onSuccess: async () => {
      setDirty(false);
      toast.success(t('settings.savedToast'));
      await utils.fireSafety.settings.get.invalidate();
      await utils.fireSafety.buildings.get.invalidate();
      await utils.fireSafety.marshals.list.invalidate();
      await utils.fireSafety.overview.invalidate();
    },
    onError: onServerError,
  });

  const toggle = (id: string) => {
    setDirty(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <main>
      <ModuleHeader
        className="mb-5"
        title={t('settings.title')}
        description={t('settings.subtitle')}
      />

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-sm font-medium">{t('settings.marshalTicket.heading')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('settings.marshalTicket.intro')}
            </p>
          </div>

          {isLoading || loadingRequirements ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-5 w-52" />
            </div>
          ) : (requirements ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('settings.marshalTicket.noRequirements')}
            </p>
          ) : (
            <ul className="space-y-2">
              {(requirements ?? []).map((r) => (
                <li key={r.id} className="flex items-start gap-2">
                  <Checkbox
                    id={`req-${r.id}`}
                    checked={selected.has(r.id)}
                    disabled={!canManage}
                    onCheckedChange={() => toggle(r.id)}
                  />
                  <Label htmlFor={`req-${r.id}`} className="font-normal leading-5">
                    {r.name}
                    {r.validityMonths !== null ? (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {t('settings.marshalTicket.validity', { months: r.validityMonths })}
                      </span>
                    ) : null}
                  </Label>
                </li>
              ))}
            </ul>
          )}

          <p className="text-sm text-muted-foreground">
            {selected.size === 0
              ? t('settings.marshalTicket.noneNote')
              : t('settings.marshalTicket.someNote')}
          </p>

          {canManage ? (
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate({ requirementIds: [...selected] })}
            >
              {tCommon('save')}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
