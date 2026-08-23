'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { MatrixThresholds } from '../../lib/risk-matrix';
import { bandFor, bandRank, scoreFor } from '../../lib/risk-matrix';
import { trpc } from '../../lib/trpc/client';
import { appConfirm } from '../ui/app-confirm';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { MatrixPicker } from './matrix-picker';
import { RiskBandChip } from './risk-band-chip';
import { useServerErrorToast } from '../../../src/lib/use-server-error';

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
  residualJustification: string;
  controls: HazardControl[];
}

const TIERS = ['eliminate', 'substitute', 'engineering', 'administrative', 'ppe'] as const;

/**
 * One hazard through HSE steps 1–3. Zero-click persistence: text fields
 * auto-save on blur; matrix cells, chips and control changes save
 * immediately. Initial and residual risk use the classic 5×5 matrix.
 * The PPE-only justification lives at the BOTTOM of the controls block
 * and only appears when the hierarchy rule demands it.
 */
export function HazardCard({
  hazard,
  matrix,
  canManage,
  canRemove,
  presetGroups,
  onChanged,
}: {
  hazard: HazardWithControls;
  matrix: MatrixThresholds;
  canManage: boolean;
  /** False when this is the assessment's only hazard — one must remain. */
  canRemove: boolean;
  presetGroups: ReadonlyArray<string>;
  onChanged: () => void;
}) {
  const t = useTranslations('riskAssessments');
  const onServerErrorG0 = useServerErrorToast(t('saveError'));
  const [text, setText] = useState(hazard.hazard);
  const [harm, setHarm] = useState(hazard.harmDescription);
  const [groups, setGroups] = useState<string[]>([...hazard.affectedGroups]);
  const [customGroup, setCustomGroup] = useState('');
  const [addingGroup, setAddingGroup] = useState(false);
  const [existing, setExisting] = useState(hazard.existingControls);
  const [iL, setIL] = useState(hazard.initialLikelihood);
  const [iS, setIS] = useState(hazard.initialSeverity);
  const [rL, setRL] = useState(hazard.residualLikelihood);
  const [rS, setRS] = useState(hazard.residualSeverity);
  const [residualNote, setResidualNote] = useState(hazard.residualJustification);

  // Last-saved snapshot so blur handlers only fire a mutation on real change.
  const saved = useRef({
    text: hazard.hazard,
    harm: hazard.harmDescription,
    existing: hazard.existingControls,
    residualNote: hazard.residualJustification,
  });

  const [controlDesc, setControlDesc] = useState('');
  const [controlTier, setControlTier] = useState<(typeof TIERS)[number]>('engineering');
  const [controlStatus, setControlStatus] = useState<'in_place' | 'planned'>('in_place');

  const update = trpc.riskAssessments.updateHazard.useMutation({
    onSuccess: onChanged,
    onError: onServerErrorG0,
  });
  const remove = trpc.riskAssessments.removeHazard.useMutation({
    onSuccess: onChanged,
    onError: (err) =>
      toast.error(err.message === 'last-hazard' ? t('hazards.lastHazardError') : t('saveError')),
  });
  const addControl = trpc.riskAssessments.addControl.useMutation({
    onSuccess: () => {
      setControlDesc('');
      onChanged();
    },
    onError: onServerErrorG0,
  });
  const updateControl = trpc.riskAssessments.updateControl.useMutation({
    onSuccess: onChanged,
    onError: onServerErrorG0,
  });
  const removeControl = trpc.riskAssessments.removeControl.useMutation({
    onSuccess: onChanged,
    onError: onServerErrorG0,
  });

  function toggleGroup(g: string): void {
    // BUG-13: derive from the LATEST state, not the render closure — two
    // fast clicks off a stale `groups` each saved a whole array missing
    // the other's toggle, and the last write won.
    setGroups((current) => {
      const next = current.includes(g) ? current.filter((x) => x !== g) : [...current, g];
      update.mutate({ hazardId: hazard.id, affectedGroups: next });
      return next;
    });
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

  const ppeControls = hazard.controls.filter((c) => c.tier === 'ppe');
  const allPpe = hazard.controls.length > 0 && ppeControls.length === hazard.controls.length;
  const hasJustification = hazard.controls.some(
    (c) => (c.ppeJustification ?? '').trim().length > 0,
  );
  const justificationTarget = ppeControls[0];

  // P-2: residual risk is "risk WITH controls" — it only becomes scorable
  // once at least one control (structured or free-text) is recorded.
  const hasAnyControl = hazard.controls.length > 0 || existing.trim().length > 0;
  const initialScore = scoreFor(iL, iS);
  const residualScore = scoreFor(rL, rS);
  const residualAboveInitial =
    initialScore !== null && residualScore !== null && residualScore > initialScore;
  const initialBand = bandFor(iL, iS, matrix);
  const residualBand = bandFor(rL, rS, matrix);
  const hasPlannedControl = hazard.controls.some((c) => c.status === 'planned');
  // P-2: a residual that stays high/critical needs a tolerability note
  // unless a planned control (the further action) exists.
  const needsResidualNote =
    bandRank(residualBand) >= bandRank('high') &&
    !hasPlannedControl &&
    residualNote.trim().length === 0;
  const showResidualNote =
    bandRank(residualBand) >= bandRank('high') || residualNote.trim().length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="text-base">{text}</CardTitle>
        <div className="flex items-center gap-2">
          <RiskBandChip score={initialScore} band={initialBand} matrix={matrix} />
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            →
          </span>
          <RiskBandChip score={residualScore} band={residualBand} matrix={matrix} />
          {canManage && canRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t('hazards.remove')}
              onClick={() => {
                // NR3-05: the native confirm() here froze a tester's page.
                void appConfirm({
                  description: t('hazards.removeConfirm'),
                  destructive: true,
                }).then((ok) => {
                  if (ok) remove.mutate({ hazardId: hazard.id });
                });
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
              // BUG-24: the server's Zod limit is 500 — cap the box so a long
              // paste is truncated visibly instead of 400ing on save.
              maxLength={500}
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
            {canManage && !addingGroup ? (
              <button
                type="button"
                onClick={() => setAddingGroup(true)}
                className="rounded-full border border-dashed border-input px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                + {t('hazards.addGroup')}
              </button>
            ) : null}
            {canManage && addingGroup ? (
              <Input
                autoFocus
                className="h-6 w-44 rounded-full px-2.5 text-xs"
                value={customGroup}
                placeholder={t('hazards.affectedCustomPlaceholder')}
                onChange={(e) => setCustomGroup(e.target.value)}
                onBlur={() => {
                  setAddingGroup(false);
                  setCustomGroup('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customGroup.trim().length > 0) {
                    e.preventDefault();
                    toggleGroup(customGroup.trim());
                    setCustomGroup('');
                    setAddingGroup(false);
                  } else if (e.key === 'Escape') {
                    setAddingGroup(false);
                    setCustomGroup('');
                  }
                }}
              />
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t('hazards.existingControlsLabel')}</Label>
          {/* Two control surfaces share this card — say how they relate (UXW1-15). */}
          <p className="text-xs text-muted-foreground">{t('hazards.existingControlsHint')}</p>
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

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-1">
            <MatrixPicker
              label={t('hazards.initialRisk')}
              likelihood={iL}
              severity={iS}
              matrix={matrix}
              disabled={!canManage}
              onPick={(l, s) => {
                setIL(l);
                setIS(s);
                update.mutate({ hazardId: hazard.id, initialLikelihood: l, initialSeverity: s });
              }}
            />
            <p className="text-xs text-muted-foreground">{t('matrixHint')}</p>
          </div>
          <div className="space-y-1">
            <MatrixPicker
              label={t('hazards.residualRisk')}
              likelihood={rL}
              severity={rS}
              matrix={matrix}
              disabled={!canManage || !hasAnyControl || initialScore === null}
              disabledHint={
                canManage
                  ? !hasAnyControl
                    ? t('matrix.residualNeedsControls')
                    : initialScore === null
                      ? t('matrix.residualNeedsInitial')
                      : undefined
                  : undefined
              }
              maxScore={initialScore}
              onPick={(l, s) => {
                setRL(l);
                setRS(s);
                update.mutate({ hazardId: hazard.id, residualLikelihood: l, residualSeverity: s });
              }}
            />
            {residualAboveInitial ? (
              <p className="text-xs font-medium text-red-600 dark:text-red-400" role="alert">
                {t('matrix.residualAboveInitialWarning')}
              </p>
            ) : null}
          </div>
        </div>

        {/* P-2: tolerability note for residuals that stay high/critical. */}
        {showResidualNote ? (
          <div className="space-y-1 rounded-md border border-orange-200 p-3 dark:border-orange-900">
            {needsResidualNote ? (
              <p className="text-xs font-medium text-orange-600 dark:text-orange-400">
                {t('matrix.residualNoteHint')}
              </p>
            ) : null}
            <Label className="text-xs">{t('matrix.residualNoteLabel')}</Label>
            <Textarea
              rows={2}
              value={residualNote}
              disabled={!canManage}
              placeholder={t('matrix.residualNotePlaceholder')}
              onChange={(e) => setResidualNote(e.target.value)}
              onBlur={() => {
                if (residualNote !== saved.current.residualNote) {
                  saved.current.residualNote = residualNote;
                  update.mutate({ hazardId: hazard.id, residualJustification: residualNote });
                }
              }}
            />
          </div>
        ) : null}

        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t('controls.sectionTitle')}</p>
            <p className="text-xs text-muted-foreground">{t('controls.hint')}</p>
          </div>
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

          {/* Hierarchy rule: only when this hazard relies on PPE alone does
              the justification appear — at the bottom, out of the way. */}
          {allPpe && justificationTarget !== undefined ? (
            <div className="space-y-1 border-t pt-2">
              {!hasJustification ? (
                <p className="text-xs font-medium text-orange-600 dark:text-orange-400">
                  {t('controls.ppeRuleHint')}
                </p>
              ) : null}
              <Label className="text-xs">{t('controls.ppeJustificationLabel')}</Label>
              <Input
                className="h-8"
                disabled={!canManage}
                defaultValue={justificationTarget.ppeJustification ?? ''}
                placeholder={t('controls.ppeJustificationPlaceholder')}
                onBlur={(e) => {
                  const v = e.target.value;
                  if (v !== (justificationTarget.ppeJustification ?? '')) {
                    updateControl.mutate({
                      controlId: justificationTarget.id,
                      ppeJustification: v,
                    });
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
