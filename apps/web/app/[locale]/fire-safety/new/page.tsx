'use client';

/**
 * Add building — the premises record that drives everything else.
 *
 * The profile (residential, height, storeys, installed systems) is what
 * seeds the statutory check calendar on create, so the form leads with
 * it and previews the duties live: tick "residential" and set 18 m and
 * the high-rise duties appear before saving — nobody discovers the
 * secure-information-box requirement three screens later.
 */
import {
  FIRE_CHECK_TYPE_SPECS,
  isAbove11mResidential,
  isHighRiseResidential,
  requiredCheckTypesFor,
  type FireBuildingProfile,
} from '@forma360/shared/fire-safety';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { DutyBadges } from '../../../../src/components/fire-safety/chips';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

export default function NewFireBuildingPage() {
  const t = useTranslations('fireSafety.create');
  const tShared = useTranslations('fireSafety');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [name, setName] = useState('');
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [address, setAddress] = useState('');
  const [useDescription, setUseDescription] = useState('');
  const [isResidential, setIsResidential] = useState(false);
  const [heightMetres, setHeightMetres] = useState('');
  const [storeys, setStoreys] = useState('');
  const [hasFireAlarm, setHasFireAlarm] = useState(true);
  const [hasEmergencyLighting, setHasEmergencyLighting] = useState(true);
  const [hasSprinklers, setHasSprinklers] = useState(false);
  const [hasDampers, setHasDampers] = useState(false);
  const [hasRisers, setHasRisers] = useState(false);

  const profile: FireBuildingProfile = {
    isResidential,
    heightMetres: heightMetres === '' ? null : Number(heightMetres),
    storeys: storeys === '' ? null : Number(storeys),
    hasFireAlarm,
    hasEmergencyLighting,
    hasSprinklers,
    hasDampers,
    hasRisers,
  };
  const duty = {
    highRiseResidential: isHighRiseResidential(profile),
    above11mResidential: isAbove11mResidential(profile),
  };
  const seededChecks = requiredCheckTypesFor(profile);

  const createMutation = trpc.fireSafety.buildings.create.useMutation({
    onSuccess: (result) => {
      toast.success(t('createdToast', { count: result.checksSeeded }));
      router.push(`/${locale}/fire-safety/${result.id}`);
    },
    onError: () => toast.error(tShared('saveError')),
  });

  function submit(): void {
    if (name.trim().length === 0) return;
    createMutation.mutate({
      name: name.trim(),
      ...(siteIds[0] !== undefined ? { siteId: siteIds[0] } : {}),
      address,
      useDescription,
      isResidential,
      heightMetres: heightMetres === '' ? null : Number(heightMetres),
      storeys: storeys === '' ? null : Number(storeys),
      hasFireAlarm,
      hasEmergencyLighting,
      hasSprinklers,
      hasDampers,
      hasRisers,
      externalWallSystem: '',
      compartmentationNotes: '',
      meansOfEscapeNotes: '',
      serviceRisersNotes: '',
      secureInfoBoxLocation: '',
      infoDocuments: [],
    });
  }

  const flags: Array<{
    key: string;
    value: boolean;
    set: (v: boolean) => void;
  }> = [
    { key: 'hasFireAlarm', value: hasFireAlarm, set: setHasFireAlarm },
    { key: 'hasEmergencyLighting', value: hasEmergencyLighting, set: setHasEmergencyLighting },
    { key: 'hasSprinklers', value: hasSprinklers, set: setHasSprinklers },
    { key: 'hasDampers', value: hasDampers, set: setHasDampers },
    { key: 'hasRisers', value: hasRisers, set: setHasRisers },
  ];

  return (
    <FocusedPageShell title={t('title')} backHref={`/${locale}/fire-safety`} width="form">
      <Card>
        <CardContent className="space-y-5 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="fb-name">{t('name')}</Label>
            <Input
              id="fb-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
            />
          </div>

          <SiteSelector value={siteIds} onChange={setSiteIds} multiple={false} />

          <div className="space-y-1.5">
            <Label htmlFor="fb-address">{t('address')}</Label>
            <Input id="fb-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="fb-use">{t('useDescription')}</Label>
            <Textarea
              id="fb-use"
              value={useDescription}
              onChange={(e) => setUseDescription(e.target.value)}
              rows={2}
              placeholder={t('useDescriptionPlaceholder')}
            />
          </div>

          <div className="rounded-md border p-4">
            <h2 className="mb-3 text-sm font-medium">{t('profileHeading')}</h2>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isResidential}
                onChange={(e) => setIsResidential(e.target.checked)}
                className="h-4 w-4"
              />
              {t('isResidential')}
            </label>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fb-height">{t('heightMetres')}</Label>
                <Input
                  id="fb-height"
                  type="number"
                  min="1"
                  step="0.1"
                  value={heightMetres}
                  onChange={(e) => setHeightMetres(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fb-storeys">{t('storeys')}</Label>
                <Input
                  id="fb-storeys"
                  type="number"
                  min="1"
                  step="1"
                  value={storeys}
                  onChange={(e) => setStoreys(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {flags.map((flag) => (
                <label key={flag.key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={flag.value}
                    onChange={(e) => flag.set(e.target.checked)}
                    className="h-4 w-4"
                  />
                  {t(`flags.${flag.key}` as never)}
                </label>
              ))}
            </div>
            {/* The list, not just the count.
                "These checks will be scheduled:" was followed by empty
                space — three systems ticked and nothing named. The
                moment you press Create it schedules eight statutory
                checks at the correct frequencies, and a practitioner
                called that "the most persuasive thing in your entire
                product… you are computing it and then hiding it behind
                the commit button." It is computed right here. */}
            <div className="mt-4 space-y-2 border-t pt-3 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <DutyBadges duty={duty} />
                <span>{t('seedPreview', { count: seededChecks.length })}</span>
              </div>
              <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {seededChecks.map((type) => (
                  <li key={type} className="flex items-baseline justify-between gap-2">
                    {/* `tShared` is the `fireSafety` namespace — these
                        labels live there, not under `fireSafety.create`. */}
                    <span className="text-foreground">
                      {tShared(`checkTypes.${type}` as never)}
                    </span>
                    <span className="shrink-0">
                      {tShared(
                        `frequencies.${FIRE_CHECK_TYPE_SPECS[type].defaultFrequency}` as never,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              onClick={submit}
              disabled={name.trim().length === 0 || createMutation.isPending}
            >
              {t('submit')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </FocusedPageShell>
  );
}
