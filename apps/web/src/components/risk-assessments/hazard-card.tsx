'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { MatrixThresholds } from '../../lib/risk-matrix';
import { scoreFor } from '../../lib/risk-matrix';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { RiskBandChip } from './risk-band-chip';

export interface HazardControl {
  id: string;
  description: string;
  tier: 'eliminate' | 'substitute' | 'engineering' | 'administrative' | 'ppe';
  status: 'in_place' | 'planned';
  ppeJustification: string | null;
  actionId: string | null;
}

export interface HazardWithControls {
  id: string;
  hazard: string;
  harmDescription: string;
  affectedGroups: ReadonlyArray<string>;
  initialLikelihood: number | null;
  initialSeverity: number | null;
  existingControls: string;
  residualLikelihood: number | null;
  residualSeverity: number | null;
  controls: HazardControl[];
}

const TIERS = ['eliminate', 'substitute', 'engineering', 'administrative', 'ppe'] as const;
const SCORES = [1, 2, 3, 4, 5] as const;

/** One-click 1–5 picker — a small segmented row instead of a dropdown. */
function ScoreButtons({
  value,
  onPick,
  label,
  disabled,
}: {
  value: number | null;
  onPick: (v: number) => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div
        className="inline-flex overflow-hidden rounded-md border"
        role="group"
        aria-label={label}
      >
        {SCORES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            aria-pressed={value === s}
            onClick={() => onPick(s)}
            className={`px-2.5 py-1 text-sm transition-colors ${
              value === s
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:bg-accent'
            } ${s !== 5 ? 'border-r' : ''}`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * One hazard through HSE steps 1–3. Zero-click persistence: text fields
 * auto-save on blur, scores / chips / control changes save immediately —
 * an assessor never has to remember a Save button.
 */
export function HazardCard({
  hazard,
  matrix,
  canManage,
  presetGroups,
  onChanged,
}: {
  hazard: HazardWithControls;
  matrix: MatrixThresholds;
  canManage: boolean;
  presetGroups: ReadonlyArray<string>;
  onChanged: () => void;
}) {
  const t = useTranslations('riskAssessments');
  const [text, setText] = useState(hazard.hazard);
  const [harm, setHarm] = useState(hazard.harmDescription);
  const [groups, setGroups] = useState<string[]>([...hazard.affectedGroups]);
  const [customGroup, setCustomGroup] = useState('');
  const [existing, setExisting] = useState(hazard.existingControls);
  const [iL, setIL] = useState(hazard.initialLikelihood);
  const [iS, setIS] = useState(hazard.initialSeverity);
  const [rL, setRL] = useState(hazard.residualLikelihood);
  const [rS, setRS] = useState(hazard.residualSeverity);

  // Last-saved snapshot so blur handlers only fire a mutation on real change.
  const saved = useRef({
    text: hazard.hazard,
    harm: hazard.harmDescription,
    existing: hazard.existingControls,
  });

  const [controlDesc, setControlDesc] = useState('');
  const [controlTier, setControlTier] = useState<(typeof TIERS)[number]>('engineering');
  const [controlStatus, setControlStatus] = useState<'in_place' | 'planned'>('in_place');

  const update = trpc.riskAssessments.updateHazard.useMutation({
    onSuccess: onChanged,
    onError: () => toast.error(t('saveError')),
  });
  const remove = trpc.riskAssessments.removeHazard.useMutation({
    onSuccess: onChanged,
    onError: () => toast.error(t('saveError')),
  });
  const addControl = trpc.riskAssessments.addControl.useMutation({
    onSuccess: () => {
      setControlDesc('');
      onChanged();
    },
    onError: () => toast.error(t('saveError')),
  });
  const updateControl = trpc.riskAssessments.updateControl.useMutation({
    onSuccess: onChanged,
    onError: () => toast.error(t('saveError')),
  });
  const removeControl = trpc.riskAssessments.removeControl.useMutation({
    onSuccess: onChanged,
    onError: () => toast.error(t('saveError')),
  });

  function persistGroups(next: string[]): void {
    setGroups(next);
    update.mutate({ hazardId: hazard.id, affectedGroups: next });
  }

  function toggleGroup(g: string): void {
    persistGroups(groups.includes(g) ? groups.filter((x) => x !== g) : [...groups, g]);
  }

  function submitControl(): void {
    if (controlDesc.trim().length === 0 || addControl.isPending) return;
    addControl.mutate({
      hazardId: hazard.id,
      description: controlDesc.trim(),
      tier: controlTier,
      status: controlStatus,
    });
  }

  const groupLabel = (g: string): string =>
    (presetGroups as ReadonlyArray<string>).includes(g) ? t(`hazards.groups.${g}` as never) : g;

  const ppeOnly =
    hazard.controls.length > 0 &&
    hazard.controls.every((c) => c.tier === 'ppe') &&
    !hazard.controls.some((c) => (c.ppeJustification ?? '').trim().length > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="text-base">{text}</CardTitle>
        <div className="flex items-center gap-2">
          <RiskBandChip score={scoreFor(iL, iS)} matrix={matrix} />
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            →
          </span>
          <RiskBandChip score={scoreFor(rL, rS)} matrix={matrix} />
          {canManage ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('hazards.remove')}
              onClick={() => {
                if (window.confirm(t('hazards.removeConfirm'))) {
                  remove.mutate({ hazardId: hazard.id });
                }
              }}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('hazards.hazardLabel')}</Label>
            <Input
              value={text}
              disabled={!canManage}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                if (text.trim().length > 0 && text !== saved.current.text) {
                  saved.current.text = text;
                  update.mutate({ hazardId: hazard.id, hazard: text });
                }
              }}
              placeholder={t('hazards.hazardPlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('hazards.harmLabel')}</Label>
            <Input
              value={harm}
              disabled={!canManage}
              onChange={(e) => setHarm(e.target.value)}
              onBlur={() => {
                if (harm !== saved.current.harm) {
                  saved.current.harm = harm;
                  update.mutate({ hazardId: hazard.id, harmDescription: harm });
                }
              }}
              placeholder={t('hazards.harmPlaceholder')}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t('hazards.affectedLabel')}</Label>
          <p className="text-xs text-muted-foreground">{t('hazards.affectedHint')}</p>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set([...presetGroups, ...groups])].map((g) => {
              const active = groups.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  disabled={!canManage}
                  onClick={() => toggleGroup(g)}
                  aria-pressed={active}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    active
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {groupLabel(g)}
                </button>
              );
            })}
          </div>
          {canManage ? (
            <Input
              className="mt-1 max-w-60"
              value={customGroup}
              placeholder={t('hazards.affectedCustomPlaceholder')}
              onChange={(e) => setCustomGroup(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customGroup.trim().length > 0) {
                  e.preventDefault();
                  toggleGroup(customGroup.trim());
                  setCustomGroup('');
                }
              }}
            />
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('hazards.initialRisk')}</Label>
            <div className="flex flex-wrap items-end gap-3">
              <ScoreButtons
                value={iL}
                onPick={(v) => {
                  setIL(v);
                  update.mutate({ hazardId: hazard.id, initialLikelihood: v });
                }}
                label={t('hazards.likelihood')}
                disabled={!canManage}
              />
              <ScoreButtons
                value={iS}
                onPick={(v) => {
                  setIS(v);
                  update.mutate({ hazardId: hazard.id, initialSeverity: v });
                }}
                label={t('hazards.severity')}
                disabled={!canManage}
              />
              <RiskBandChip score={scoreFor(iL, iS)} matrix={matrix} />
            </div>
            <p className="text-xs text-muted-foreground">{t('hazards.scoreHint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label>{t('hazards.residualRisk')}</Label>
            <div className="flex flex-wrap items-end gap-3">
              <ScoreButtons
                value={rL}
                onPick={(v) => {
                  setRL(v);
                  update.mutate({ hazardId: hazard.id, residualLikelihood: v });
                }}
                label={t('hazards.likelihood')}
                disabled={!canManage}
              />
              <ScoreButtons
                value={rS}
                onPick={(v) => {
                  setRS(v);
                  update.mutate({ hazardId: hazard.id, residualSeverity: v });
                }}
                label={t('hazards.severity')}
                disabled={!canManage}
              />
              <RiskBandChip score={scoreFor(rL, rS)} matrix={matrix} />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t('hazards.existingControlsLabel')}</Label>
          <Textarea
            value={existing}
            disabled={!canManage}
            rows={2}
            onChange={(e) => setExisting(e.target.value)}
            onBlur={() => {
              if (existing !== saved.current.existing) {
                saved.current.existing = existing;
                update.mutate({ hazardId: hazard.id, existingControls: existing });
              }
            }}
            placeholder={t('hazards.existingControlsPlaceholder')}
          />
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t('controls.sectionTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('controls.hint')}</p>
          </div>
          {ppeOnly ? (
            <p className="text-xs font-medium text-orange-600 dark:text-orange-400">
              {t('controls.ppeRuleHint')}
            </p>
          ) : null}
          <ul className="space-y-2">
            {hazard.controls.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t(`controls.tier.${c.tier}`)}
                </span>
                <span className="min-w-0 flex-1 break-words">{c.description}</span>
                {canManage ? (
                  <Select
                    value={c.status}
                    onValueChange={(v) =>
                      updateControl.mutate({
                        controlId: c.id,
                        status: v === 'planned' ? 'planned' : 'in_place',
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_place">{t('controls.statusInPlace')}</SelectItem>
                      <SelectItem value="planned">{t('controls.statusPlanned')}</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {c.status === 'in_place'
                      ? t('controls.statusInPlace')
                      : t('controls.statusPlanned')}
                  </span>
                )}
                {c.actionId !== null ? (
                  <span className="text-xs text-emerald-600 dark:text-emerald-400">
                    {t('controls.actionLink')}
                  </span>
                ) : null}
                {canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('controls.remove')}
                    onClick={() => removeControl.mutate({ controlId: c.id })}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
                {c.tier === 'ppe' && canManage ? (
                  <Input
                    className="h-8 w-full"
                    defaultValue={c.ppeJustification ?? ''}
                    placeholder={t('controls.ppeJustificationPlaceholder')}
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (c.ppeJustification ?? '')) {
                        updateControl.mutate({ controlId: c.id, ppeJustification: v });
                      }
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <div className="min-w-40 flex-1 space-y-1">
                <Label className="text-xs">{t('controls.descriptionLabel')}</Label>
                <Input
                  value={controlDesc}
                  onChange={(e) => setControlDesc(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitControl();
                    }
                  }}
                  placeholder={t('controls.descriptionPlaceholder')}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('controls.tierLabel')}</Label>
                <Select
                  value={controlTier}
                  onValueChange={(v) => {
                    const tier = TIERS.find((x) => x === v);
                    if (tier !== undefined) setControlTier(tier);
                  }}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIERS.map((tier) => (
                      <SelectItem key={tier} value={tier}>
                        {t(`controls.tier.${tier}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t('controls.statusLabel')}</Label>
                <Select
                  value={controlStatus}
                  onValueChange={(v) => setControlStatus(v === 'planned' ? 'planned' : 'in_place')}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in_place">{t('controls.statusInPlace')}</SelectItem>
                    <SelectItem value="planned">{t('controls.statusPlanned')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={controlDesc.trim().length === 0 || addControl.isPending}
                onClick={submitControl}
              >
                {t('controls.save')}
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
