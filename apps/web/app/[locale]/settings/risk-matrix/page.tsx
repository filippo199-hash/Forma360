'use client';

/**
 * Tenant risk-matrix editor (FreeHS B1, feedback P-4). Band thresholds +
 * per-severity floors ("severity 5 ⇒ minimum band High"), with a live
 * 5×5 preview so the assessor sees exactly what the pickers will show.
 *
 * The matrix is snapshotted per assessment: new assessments pick this up
 * immediately, open drafts only when "apply to drafts" is ticked, and
 * published versions always keep the matrix they were signed against —
 * history never rescores itself.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { bandChipClasses, bandFor, type RiskMatrixConfig } from '../../../../src/lib/risk-matrix';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../src/components/ui/card';
import { Checkbox } from '../../../../src/components/ui/checkbox';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../src/components/ui/select';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

const STEPS = [1, 2, 3, 4, 5] as const;
const SEVERITIES = ['5', '4', '3', '2', '1'] as const;
type FloorValue = 'none' | 'medium' | 'high' | 'critical';

export default function RiskMatrixSettingsPage() {
  const t = useTranslations('riskAssessments.matrixSettings');
  const tRa = useTranslations('riskAssessments');
  const canEdit = useHasPermission('org.settings');
  const utils = trpc.useUtils();

  const settings = trpc.riskAssessments.getMatrixSettings.useQuery();
  const [lowMax, setLowMax] = useState('4');
  const [mediumMax, setMediumMax] = useState('9');
  const [highMax, setHighMax] = useState('15');
  const [floors, setFloors] = useState<Record<string, FloorValue>>({});
  const [applyToDrafts, setApplyToDrafts] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settings.data !== undefined && !loaded) {
      setLowMax(String(settings.data.lowMax));
      setMediumMax(String(settings.data.mediumMax));
      setHighMax(String(settings.data.highMax));
      const next: Record<string, FloorValue> = {};
      for (const [sev, band] of Object.entries(settings.data.severityFloors)) {
        // A 'low' floor is a no-op — normalise it to "no override".
        next[sev] = band === 'low' ? 'none' : band;
      }
      setFloors(next);
      setLoaded(true);
    }
  }, [settings.data, loaded]);

  const save = trpc.riskAssessments.updateMatrixSettings.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.draftsUpdated > 0 ? t('savedWithDrafts', { count: res.draftsUpdated }) : t('saved'),
      );
      void utils.riskAssessments.getMatrixSettings.invalidate();
      void utils.riskAssessments.list.invalidate();
    },
    onError: (err) =>
      toast.error(err.message === 'invalid-matrix' ? t('invalidThresholds') : t('saveError')),
  });

  const low = Number.parseInt(lowMax, 10);
  const medium = Number.parseInt(mediumMax, 10);
  const high = Number.parseInt(highMax, 10);
  const valid =
    Number.isInteger(low) &&
    Number.isInteger(medium) &&
    Number.isInteger(high) &&
    low >= 1 &&
    low < medium &&
    medium < high &&
    high < 25;

  const previewMatrix: RiskMatrixConfig = {
    lowMax: valid ? low : 4,
    mediumMax: valid ? medium : 9,
    highMax: valid ? high : 15,
    severityFloors: Object.fromEntries(
      Object.entries(floors).filter(
        (entry): entry is [string, 'medium' | 'high' | 'critical'] => entry[1] !== 'none',
      ),
    ),
  };

  function submit(): void {
    if (!valid || save.isPending) return;
    save.mutate({
      lowMax: low,
      mediumMax: medium,
      highMax: high,
      severityFloors: previewMatrix.severityFloors ?? {},
      applyToDrafts,
    });
  }

  if (settings.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('thresholdsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{t('thresholdsHint')}</p>
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t('lowMaxLabel')}</Label>
              <Input
                type="number"
                min={1}
                max={23}
                className="w-24"
                value={lowMax}
                disabled={!canEdit}
                onChange={(e) => setLowMax(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('mediumMaxLabel')}</Label>
              <Input
                type="number"
                min={2}
                max={24}
                className="w-24"
                value={mediumMax}
                disabled={!canEdit}
                onChange={(e) => setMediumMax(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('highMaxLabel')}</Label>
              <Input
                type="number"
                min={3}
                max={24}
                className="w-24"
                value={highMax}
                disabled={!canEdit}
                onChange={(e) => setHighMax(e.target.value)}
              />
            </div>
          </div>
          {!valid ? (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {t('invalidThresholds')}
            </p>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium">{t('floorsTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('floorsHint')}</p>
            <div className="flex flex-wrap gap-3">
              {SEVERITIES.map((sev) => (
                <div key={sev} className="space-y-1">
                  <Label className="text-xs">{t('floorLabel', { severity: sev })}</Label>
                  <Select
                    value={floors[sev] ?? 'none'}
                    onValueChange={(v) =>
                      setFloors((prev) => ({ ...prev, [sev]: v as FloorValue }))
                    }
                  >
                    <SelectTrigger className="w-36" disabled={!canEdit}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t('floorNone')}</SelectItem>
                      <SelectItem value="medium">{tRa('band.medium')}</SelectItem>
                      <SelectItem value="high">{tRa('band.high')}</SelectItem>
                      <SelectItem value="critical">{tRa('band.critical')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('previewTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="inline-grid grid-cols-[auto_repeat(5,minmax(0,1fr))] gap-0.5">
            {[...STEPS].reverse().map((s) => (
              <div key={`row-${s}`} className="contents">
                <span className="flex w-5 items-center justify-center text-[10px] text-muted-foreground">
                  {`S${s}`}
                </span>
                {STEPS.map((l) => {
                  const band = bandFor(l, s, previewMatrix);
                  return (
                    <span
                      key={`${l}-${s}`}
                      title={`L${l} × S${s} = ${l * s} — ${tRa(`band.${band}`)}`}
                      className={`flex h-10 w-12 flex-col items-center justify-center rounded-sm text-[11px] font-semibold ${bandChipClasses(band)}`}
                    >
                      <span>{l * s}</span>
                      <span className="text-[8px] font-medium uppercase">
                        {tRa(`band.${band}`)}
                      </span>
                    </span>
                  );
                })}
              </div>
            ))}
            <span />
            {STEPS.map((l) => (
              <span
                key={`col-${l}`}
                className="pt-0.5 text-center text-[10px] text-muted-foreground"
              >
                {`L${l}`}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            checked={applyToDrafts}
            disabled={!canEdit}
            onCheckedChange={(v) => setApplyToDrafts(v === true)}
            className="mt-0.5"
          />
          <span>
            {t('applyToDrafts')}
            <span className="block text-xs text-muted-foreground">{t('applyToDraftsHint')}</span>
          </span>
        </label>
        <p className="text-xs text-muted-foreground">{t('historyNote')}</p>
        {canEdit ? (
          <Button type="button" disabled={!valid || save.isPending} onClick={submit}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
