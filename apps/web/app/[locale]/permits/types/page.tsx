'use client';

/**
 * Permit-type catalogue management. The nine seeded types (and any
 * tenant-defined ones) with their control requirements: signature /
 * evidence flags, duration cap, and the precondition checklist that gets
 * snapshotted onto every new permit. Editing a type never rewrites
 * existing permits — the checklist is copied at creation.
 */
import { ArrowLeft, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { CategoryChip } from '../../../../src/components/permits/chips';
import {
  PermitErrorText,
  usePermitErrorText,
} from '../../../../src/components/permits/permit-error';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Switch } from '../../../../src/components/ui/switch';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { brandHasModule } from '@forma360/shared/brand';
import { GAS_READING_BOUNDS, isGasReadingValueInBounds } from '@forma360/shared/permits';
import { activeBrand } from '../../../../src/lib/brand';
import { trpc } from '../../../../src/lib/trpc/client';

const FLAG_KEYS = [
  'requiresAuthoriser',
  'requiresGasTesting',
  'requiresIsolationCertificate',
  'requiresRescuePlan',
  'requiresRiskAssessment',
  // Found by the TR-B1 contract test: the RAMS gate had the same defect as
  // the competence gate — enforced on issue, with no way to switch it on.
  'requiresRamsPack',
] as const;
type FlagKey = (typeof FLAG_KEYS)[number];

const GAS_UNITS = ['percent_lel', 'percent_o2', 'ppm', 'mg_m3'] as const;
const GAS_UNIT_LABELS: Record<string, string> = {
  percent_lel: '% LEL',
  percent_o2: '% O₂',
  ppm: 'ppm',
  mg_m3: 'mg/m³',
};

function rangeLabel(min: number | null, max: number | null, unit: string): string {
  const u = GAS_UNIT_LABELS[unit] ?? unit;
  if (min !== null && max !== null) return `${min}–${max} ${u}`;
  if (max !== null) return `≤ ${max} ${u}`;
  if (min !== null) return `≥ ${min} ${u}`;
  return u;
}

export default function PermitTypesPage() {
  const t = useTranslations('permits.types');
  const tCommon = useTranslations('common');
  const permitErrorText = usePermitErrorText();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('permits.manage');
  // The competence catalogue, for the gate's multi-select. Only queried
  // where the brand ships the module (ADR 0010).
  const trainingEnabled = brandHasModule(activeBrand.id, 'training');
  const { data: requirements } = trpc.training.listRequirements.useQuery(
    {},
    { enabled: trainingEnabled },
  );

  const utils = trpc.useUtils();
  const { data: types, isLoading } = trpc.permits.types.list.useQuery({ includeArchived: true });

  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPrecondition, setNewPrecondition] = useState<Record<string, string>>({});
  // Per-type draft state for the add-gas-limit row (PW-1).
  const [newLimit, setNewLimit] = useState<
    Record<string, { label: string; unit: (typeof GAS_UNITS)[number]; min: string; max: string }>
  >({});

  const refresh = () => {
    setError(null);
    void utils.permits.types.list.invalidate();
  };
  // NR-10: the banner alone renders at the top of the page while the
  // create card is the LAST element, below all nine seeded types — so a
  // duplicate-name refusal was off-screen and the create looked silently
  // swallowed. Toast as well, same as the permit detail page (BUG-05).
  const onError = (err: { message: string }) => {
    setError(err.message);
    toast.error(permitErrorText(err.message) ?? tCommon('error'));
  };

  // NR-10: the full list (includeArchived) is already in memory, so a
  // duplicate name can be flagged before the round trip. Case-insensitive,
  // like the server's check.
  const duplicateNewName =
    newName.trim() !== '' &&
    (types ?? []).some((row) => row.name.trim().toLowerCase() === newName.trim().toLowerCase());

  const updateType = trpc.permits.types.update.useMutation({ onSuccess: refresh, onError });
  const archiveType = trpc.permits.types.archive.useMutation({ onSuccess: refresh, onError });
  const createType = trpc.permits.types.create.useMutation({
    onSuccess: () => {
      refresh();
      setNewName('');
    },
    onError,
  });

  function toggleFlag(typeId: string, key: FlagKey, value: boolean): void {
    updateType.mutate({ typeId, [key]: value });
  }

  function addGasLimit(
    typeId: string,
    existing: ReadonlyArray<{
      id: string;
      label: string;
      unit: string;
      min: number | null;
      max: number | null;
    }>,
  ): void {
    const draft = newLimit[typeId];
    if (draft === undefined || draft.label.trim() === '') return;
    const min = draft.min.trim() === '' ? null : Number(draft.min);
    const max = draft.max.trim() === '' ? null : Number(draft.max);
    if ((min !== null && Number.isNaN(min)) || (max !== null && Number.isNaN(max))) return;
    if (min === null && max === null) return;
    // NR-03: a limit outside the unit's physical range ("max 9999 % LEL")
    // is a typo — the Add button is disabled and a hint shown; this guard
    // backs it up against a click that lands mid-render.
    if (
      (min !== null && !isGasReadingValueInBounds(draft.unit, min)) ||
      (max !== null && !isGasReadingValueInBounds(draft.unit, max)) ||
      (min !== null && max !== null && min > max)
    ) {
      return;
    }
    const slug = `${draft.label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30)}_${String(existing.length + 1)}`;
    updateType.mutate({
      typeId,
      gasLimits: [
        ...existing.map((l) => ({
          id: l.id,
          label: l.label,
          unit: l.unit as (typeof GAS_UNITS)[number],
          min: l.min,
          max: l.max,
        })),
        { id: slug, label: draft.label.trim(), unit: draft.unit, min, max },
      ],
    });
    setNewLimit((prev) => ({
      ...prev,
      [typeId]: { label: '', unit: 'percent_lel', min: '', max: '' },
    }));
  }

  function addPrecondition(
    typeId: string,
    existing: ReadonlyArray<{ id: string; label: string }>,
  ): void {
    const label = (newPrecondition[typeId] ?? '').trim();
    if (label === '') return;
    const slug = `${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40)}_${String(existing.length + 1)}`;
    updateType.mutate({
      typeId,
      preconditions: [...existing, { id: slug, label }],
    });
    setNewPrecondition((prev) => ({ ...prev, [typeId]: '' }));
  }

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 sm:space-y-6">
      <header>
        <Link
          href={`/${locale}/permits`}
          className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>

      <PermitErrorText message={error} />

      {isLoading ? (
        <Card>
          <CardContent className="p-4">
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      ) : (
        (types ?? []).map((type) => {
          const archived = type.archivedAt !== null;
          // NR-03: bounds for the add-limit draft row, per selected unit.
          const limitDraft = newLimit[type.id];
          const limitUnit = limitDraft?.unit ?? 'percent_lel';
          const limitBounds = GAS_READING_BOUNDS[limitUnit];
          const draftMin = (limitDraft?.min ?? '').trim();
          const draftMax = (limitDraft?.max ?? '').trim();
          const limitDraftOutOfBounds =
            (draftMin !== '' &&
              !Number.isNaN(Number(draftMin)) &&
              !isGasReadingValueInBounds(limitUnit, Number(draftMin))) ||
            (draftMax !== '' &&
              !Number.isNaN(Number(draftMax)) &&
              !isGasReadingValueInBounds(limitUnit, Number(draftMax)));
          return (
            <Card key={type.id} className={archived ? 'opacity-60' : ''}>
              <CardContent className="space-y-3 p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <CategoryChip category={type.category} name={type.name} />
                    {type.isSystem ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {t('systemBadge')}
                      </span>
                    ) : null}
                    {archived ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground line-through">
                        {t('archivedBadge')}
                      </span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {t('openCount', { count: type.openPermitCount })}
                    </span>
                  </div>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => archiveType.mutate({ typeId: type.id, restore: archived })}
                    >
                      {archived ? t('restore') : t('archive')}
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {FLAG_KEYS.map((key) => (
                    <label
                      key={key}
                      className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                    >
                      <span>{t(`flags.${key}` as never)}</span>
                      <Switch
                        checked={type[key]}
                        disabled={!canManage || archived}
                        onCheckedChange={(v) => toggleFlag(type.id, key, v)}
                      />
                    </label>
                  ))}
                </div>

                {/* TR-B1: the competence gate's arming control. The gate was
                    wired server-side and could not be switched on from
                    anywhere — `requiredTrainingIds` appeared in no .tsx file
                    at all, so every seeded type shipped an empty list and
                    nothing was enforced. Brand-gated: only where the module
                    ships. */}
                {trainingEnabled ? (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t('requiredTraining')}</p>
                    <p className="text-xs text-muted-foreground">{t('requiredTrainingHint')}</p>
                    <div className="flex flex-wrap gap-2">
                      {(requirements ?? []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          {t('requiredTrainingNone')}
                        </span>
                      ) : (
                        (requirements ?? []).map((req) => {
                          const on = type.requiredTrainingIds.includes(req.id);
                          return (
                            <label
                              key={req.id}
                              className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={!canManage || archived}
                                className="h-3.5 w-3.5"
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...type.requiredTrainingIds, req.id]
                                    : type.requiredTrainingIds.filter((id) => id !== req.id);
                                  updateType.mutate({
                                    typeId: type.id,
                                    requiredTrainingIds: next,
                                  });
                                }}
                              />
                              {req.name}
                            </label>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{t('description')}</p>
                  <Input
                    defaultValue={type.description}
                    disabled={!canManage || archived}
                    // Same silent-Zod class as the name cap (NR-10).
                    maxLength={2000}
                    className="h-8"
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== type.description) {
                        updateType.mutate({ typeId: type.id, description: v });
                      }
                    }}
                  />
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{t('maxDuration')}</span>
                  <Input
                    type="number"
                    min={1}
                    max={72}
                    defaultValue={type.maxDurationHours}
                    disabled={!canManage || archived}
                    className="h-8 w-20"
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isInteger(v) && v >= 1 && v <= 72 && v !== type.maxDurationHours) {
                        updateType.mutate({ typeId: type.id, maxDurationHours: v });
                      }
                    }}
                  />
                  <span className="text-muted-foreground">{t('hours')}</span>
                </div>

                {/* Gas limits (PW-1): the acceptable ranges the gas gate
                    evaluates readings against, plus the freshness window. */}
                {type.requiresGasTesting || type.gasLimits.length > 0 ? (
                  <div>
                    <p className="text-sm font-medium">{t('gasLimits')}</p>
                    <ul className="mt-1.5 space-y-1">
                      {type.gasLimits.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                          <span>
                            {l.label}{' '}
                            <span className="text-muted-foreground">
                              {rangeLabel(l.min, l.max, l.unit)}
                            </span>
                          </span>
                          {canManage && !archived ? (
                            <button
                              type="button"
                              aria-label={t('removeGasLimit')}
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() =>
                                updateType.mutate({
                                  typeId: type.id,
                                  gasLimits: type.gasLimits
                                    .filter((x) => x.id !== l.id)
                                    .map((x) => ({
                                      id: x.id,
                                      label: x.label,
                                      unit: x.unit,
                                      min: x.min,
                                      max: x.max,
                                    })),
                                })
                              }
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                      {type.gasLimits.length === 0 ? (
                        <li className="text-sm text-muted-foreground">{t('noGasLimits')}</li>
                      ) : null}
                    </ul>
                    {canManage && !archived ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Input
                          value={newLimit[type.id]?.label ?? ''}
                          onChange={(e) =>
                            setNewLimit((prev) => ({
                              ...prev,
                              [type.id]: {
                                label: e.target.value,
                                unit: prev[type.id]?.unit ?? 'percent_lel',
                                min: prev[type.id]?.min ?? '',
                                max: prev[type.id]?.max ?? '',
                              },
                            }))
                          }
                          placeholder={t('gasLimitLabelPlaceholder')}
                          className="h-9 w-40"
                        />
                        <select
                          aria-label={t('gasLimitUnit')}
                          value={newLimit[type.id]?.unit ?? 'percent_lel'}
                          onChange={(e) =>
                            setNewLimit((prev) => ({
                              ...prev,
                              [type.id]: {
                                label: prev[type.id]?.label ?? '',
                                unit: e.target.value as (typeof GAS_UNITS)[number],
                                min: prev[type.id]?.min ?? '',
                                max: prev[type.id]?.max ?? '',
                              },
                            }))
                          }
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          {GAS_UNITS.map((u) => (
                            <option key={u} value={u}>
                              {GAS_UNIT_LABELS[u]}
                            </option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          step="any"
                          min={limitBounds.min}
                          max={limitBounds.max}
                          value={newLimit[type.id]?.min ?? ''}
                          onChange={(e) =>
                            setNewLimit((prev) => ({
                              ...prev,
                              [type.id]: {
                                label: prev[type.id]?.label ?? '',
                                unit: prev[type.id]?.unit ?? 'percent_lel',
                                min: e.target.value,
                                max: prev[type.id]?.max ?? '',
                              },
                            }))
                          }
                          placeholder={t('gasLimitMin')}
                          className="h-9 w-24"
                        />
                        <Input
                          type="number"
                          step="any"
                          min={limitBounds.min}
                          max={limitBounds.max}
                          value={newLimit[type.id]?.max ?? ''}
                          onChange={(e) =>
                            setNewLimit((prev) => ({
                              ...prev,
                              [type.id]: {
                                label: prev[type.id]?.label ?? '',
                                unit: prev[type.id]?.unit ?? 'percent_lel',
                                min: prev[type.id]?.min ?? '',
                                max: e.target.value,
                              },
                            }))
                          }
                          placeholder={t('gasLimitMax')}
                          className="h-9 w-24"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            (newLimit[type.id]?.label ?? '').trim() === '' || limitDraftOutOfBounds
                          }
                          onClick={() => addGasLimit(type.id, type.gasLimits)}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('addGasLimit')}
                        </Button>
                        {limitDraftOutOfBounds ? (
                          <span className="w-full text-xs text-red-600 dark:text-red-400">
                            {t('limitBounds', {
                              min: limitBounds.min,
                              max: limitBounds.max,
                              unit: GAS_UNIT_LABELS[limitUnit] ?? limitUnit,
                            })}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{t('gasFreshness')}</span>
                      <Input
                        type="number"
                        min={5}
                        max={1440}
                        defaultValue={type.gasTestMaxAgeMinutes}
                        disabled={!canManage || archived}
                        className="h-8 w-20"
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (
                            Number.isInteger(v) &&
                            v >= 5 &&
                            v <= 1440 &&
                            v !== type.gasTestMaxAgeMinutes
                          ) {
                            updateType.mutate({ typeId: type.id, gasTestMaxAgeMinutes: v });
                          }
                        }}
                      />
                      <span className="text-muted-foreground">{t('gasFreshnessUnit')}</span>
                    </div>
                  </div>
                ) : null}

                <div>
                  <p className="text-sm font-medium">{t('preconditions')}</p>
                  <ul className="mt-1.5 space-y-1">
                    {type.preconditions.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                        <span>{p.label}</span>
                        {canManage && !archived ? (
                          <button
                            type="button"
                            aria-label={t('removePrecondition')}
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              updateType.mutate({
                                typeId: type.id,
                                preconditions: type.preconditions.filter((x) => x.id !== p.id),
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {canManage && !archived ? (
                    <div className="mt-2 flex items-center gap-2">
                      <Input
                        value={newPrecondition[type.id] ?? ''}
                        onChange={(e) =>
                          setNewPrecondition((prev) => ({ ...prev, [type.id]: e.target.value }))
                        }
                        placeholder={t('addPreconditionPlaceholder')}
                        className="h-9 max-w-md"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={(newPrecondition[type.id] ?? '').trim() === ''}
                        onClick={() => addPrecondition(type.id, type.preconditions)}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('addPrecondition')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {canManage ? (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <h2 className="font-semibold">{t('createTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('createHint')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t('createNamePlaceholder')}
                // NR-10: matches typeCreateInput's z.max(200) — an over-long
                // name used to 400 with the refusal rendered off-screen.
                maxLength={200}
                className="h-9 max-w-md"
              />
              <Button
                disabled={newName.trim() === '' || duplicateNewName || createType.isPending}
                onClick={() => createType.mutate({ category: 'other', name: newName.trim() })}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('createButton')}
              </Button>
            </div>
            {duplicateNewName ? (
              // NR-10: the server's CONFLICT check stays authoritative —
              // this pre-check just says so beside the field, not in a
              // banner three screens up.
              <p className="text-sm text-red-600 dark:text-red-400">
                {permitErrorText('duplicate-name')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
