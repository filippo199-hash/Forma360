'use client';

/**
 * Report an incident — the mobile-first three-minute form (S2).
 *
 * Progressive: the minimum viable record first (what / kind / when /
 * where), the kind-specific block second, people third, photos after
 * the record exists. The draft survives signal loss via localStorage
 * (the conduct-flow pattern): every change is saved locally, a failed
 * submit keeps the draft with a retry banner, and success clears it.
 */
import { Camera, Check, ChevronLeft, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  BODY_PARTS,
  COST_BANDS,
  CONTAMINATION_STATUSES,
  DANGEROUS_OCCURRENCE_CATEGORIES,
  INCIDENT_KINDS,
  INJURY_KINDS,
  PERPETRATOR_TYPES,
  PERSON_CATEGORIES,
  VA_NATURES,
  type IncidentKind,
} from '@forma360/shared/incidents';
import { IncidentErrorText } from '../../../../src/components/incidents/incident-error';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { trpc } from '../../../../src/lib/trpc/client';

const DRAFT_KEY = 'forma360:incident:draft:new';

interface PersonDraft {
  name: string;
  category: (typeof PERSON_CATEGORIES)[number];
  bodyParts: string[];
  injuryKinds: string[];
  firstAidGiven: boolean;
  hospitalisation: 'none' | 'ae' | 'admitted';
}

interface FormDraft {
  title: string;
  kind: IncidentKind;
  occurredAt: string; // datetime-local value
  siteId: string;
  locationText: string;
  description: string;
  details: Record<string, unknown>;
  persons: PersonDraft[];
}

function nowLocalValue(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function emptyDraft(): FormDraft {
  return {
    title: '',
    kind: 'injury',
    occurredAt: nowLocalValue(),
    siteId: '',
    locationText: '',
    description: '',
    details: {},
    persons: [],
  };
}

function loadDraft(): FormDraft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as FormDraft;
    if (typeof parsed.title !== 'string' || typeof parsed.kind !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(draft: FormDraft): void {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Private mode / quota — the form still works, it just loses offline safety.
  }
}

function clearDraft(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

export default function NewIncidentPage() {
  const t = useTranslations('incidents');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

  const [draft, setDraft] = useState<FormDraft>(emptyDraft);
  const [restored, setRestored] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const utils = trpc.useUtils();

  // Restore a locally saved draft once on mount (PF-10: signal-tolerant).
  useEffect(() => {
    const saved = loadDraft();
    if (saved !== null) {
      setDraft(saved);
      setRestored(true);
    }
  }, []);

  function patch(partial: Partial<FormDraft>): void {
    setDraft((prev) => {
      const next = { ...prev, ...partial };
      saveDraft(next);
      return next;
    });
  }

  function patchDetails(partial: Record<string, unknown>): void {
    patch({ details: { ...draft.details, ...partial } });
  }

  const createMutation = trpc.incidents.create.useMutation({
    onSuccess: (result) => {
      clearDraft();
      setSubmitError(null);
      setCreatedId(result.incidentId);
    },
    onError: (err) => setSubmitError(err),
  });

  function submit(): void {
    setSubmitError(null);
    createMutation.mutate({
      title: draft.title,
      kind: draft.kind,
      occurredAt: new Date(draft.occurredAt),
      ...(draft.siteId !== '' ? { siteId: draft.siteId } : {}),
      locationText: draft.locationText,
      description: draft.description,
      details: draft.details,
      persons: draft.persons
        .filter((p) => p.name.trim() !== '')
        .map((p) => ({
          name: p.name.trim(),
          category: p.category,
          injury: {
            bodyParts: p.bodyParts as never,
            injuryKinds: p.injuryKinds as never,
            firstAidGiven: p.firstAidGiven,
            hospitalisation: p.hospitalisation,
          },
          ohFollowUpRequired: false,
        })),
    });
  }

  async function uploadFiles(files: FileList): Promise<void> {
    if (createdId === null) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('incidentId', createdId);
        form.append('file', file);
        const res = await fetch('/api/upload/incident-evidence', { method: 'POST', body: form });
        if (!res.ok) continue;
        const body = (await res.json()) as { storageKey: string; filename: string };
        await utils.client.incidents.addEvidence.mutate({
          incidentId: createdId,
          kind: file.type.startsWith('image/') ? 'photo' : 'document',
          storageKey: body.storageKey,
          filename: body.filename,
        });
        setUploadedCount((n) => n + 1);
      }
    } finally {
      setUploading(false);
    }
  }

  const needsPersonBlock = draft.kind === 'injury' || draft.kind === 'ill_health';

  // ── Post-create photo step ────────────────────────────────────────────────
  if (createdId !== null) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-4 p-4 md:p-6">
        <h1 className="text-xl font-semibold">{t('new.photosTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('new.photosHint')}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files !== null && e.target.files.length > 0) {
              void uploadFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="mr-1.5 h-4 w-4" />
          {uploading ? t('new.uploading') : t('new.addPhotos')}
        </Button>
        {uploadedCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('new.uploadedCount', { count: uploadedCount })}
          </p>
        ) : null}
        <Button
          type="button"
          className="w-full"
          onClick={() => router.push(`/${locale}/incidents/${createdId}`)}
        >
          <Check className="mr-1.5 h-4 w-4" />
          {t('new.done')}
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/${locale}/incidents`}>
            <ChevronLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t('new.title')}</h1>
      </div>

      {restored ? <p className="text-xs text-muted-foreground">{t('new.draftRestored')}</p> : null}

      {/* ── Minimum viable record ── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="incident-title">{t('new.whatHappened')}</Label>
            <Input
              id="incident-title"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder={t('new.titlePlaceholder')}
              maxLength={300}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t('new.kind')}</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {INCIDENT_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => patch({ kind, details: {} })}
                  className={`rounded-md border px-2 py-2 text-left text-sm ${
                    draft.kind === kind
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  {t(`kinds.${kind}` as never)}
                </button>
              ))}
            </div>
            {draft.kind === 'sharps_exposure' || draft.kind === 'violence_aggression' ? (
              <p className="text-xs text-muted-foreground">{t('new.confidentialHint')}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="incident-occurred">{t('new.when')}</Label>
            <Input
              id="incident-occurred"
              type="datetime-local"
              value={draft.occurredAt}
              max={nowLocalValue()}
              onChange={(e) => patch({ occurredAt: e.target.value })}
            />
          </div>
          <SiteSelector
            value={draft.siteId === '' ? [] : [draft.siteId]}
            onChange={(next) => patch({ siteId: next[0] ?? '' })}
            multiple={false}
            label={t('new.site')}
            placeholder={t('new.sitePlaceholder')}
          />
          <div className="space-y-1.5">
            <Label htmlFor="incident-location">{t('new.location')}</Label>
            <Input
              id="incident-location"
              value={draft.locationText}
              onChange={(e) => patch({ locationText: e.target.value })}
              placeholder={t('new.locationPlaceholder')}
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="incident-description">{t('new.description')}</Label>
            <Textarea
              id="incident-description"
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder={t('new.descriptionPlaceholder')}
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Kind-specific block ── */}
      {draft.kind === 'sharps_exposure' ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('new.sharpsHeading')}</h2>
            <div className="space-y-1.5">
              <Label>{t('details.device')}</Label>
              <Input
                value={String(draft.details.device ?? '')}
                onChange={(e) => patchDetails({ device: e.target.value })}
                placeholder={t('details.devicePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('details.procedure')}</Label>
              <Input
                value={String(draft.details.procedure ?? '')}
                onChange={(e) => patchDetails({ procedure: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('details.contaminationStatus')}</Label>
              <select
                value={String(draft.details.contaminationStatus ?? 'unknown')}
                onChange={(e) => patchDetails({ contaminationStatus: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {CONTAMINATION_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`details.contamination.${s}` as never)}
                  </option>
                ))}
              </select>
            </div>
            {(
              [
                ['sourceKnown', t('details.sourceKnown')],
                ['sourceRiskAssessed', t('details.sourceRiskAssessed')],
                ['washedConfirmed', t('details.washedConfirmed')],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={draft.details[key] === true}
                  onChange={(e) => patchDetails({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {draft.kind === 'violence_aggression' ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('new.vaHeading')}</h2>
            <div className="space-y-1.5">
              <Label>{t('details.nature')}</Label>
              <select
                value={String(draft.details.nature ?? '')}
                onChange={(e) => patchDetails({ nature: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">—</option>
                {VA_NATURES.map((n) => (
                  <option key={n} value={n}>
                    {t(`details.vaNature.${n}` as never)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('details.perpetratorType')}</Label>
              <select
                value={String(draft.details.perpetratorType ?? '')}
                onChange={(e) => patchDetails({ perpetratorType: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">—</option>
                {PERPETRATOR_TYPES.map((p) => (
                  <option key={p} value={p}>
                    {t(`details.perpetrator.${p}` as never)}
                  </option>
                ))}
              </select>
            </div>
            {(
              [
                ['weaponInvolved', t('details.weaponInvolved')],
                ['policeNotified', t('details.policeNotified')],
                ['supportOffered', t('details.supportOffered')],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={draft.details[key] === true}
                  onChange={(e) => patchDetails({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            {draft.details.policeNotified === true ? (
              <div className="space-y-1.5">
                <Label>{t('details.crimeReference')}</Label>
                <Input
                  value={String(draft.details.crimeReference ?? '')}
                  onChange={(e) => patchDetails({ crimeReference: e.target.value })}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {draft.kind === 'dangerous_occurrence' ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('new.doHeading')}</h2>
            <div className="space-y-1.5">
              <Label>{t('details.doCategory')}</Label>
              <select
                value={String(draft.details.category ?? '')}
                onChange={(e) => patchDetails({ category: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="">—</option>
                {DANGEROUS_OCCURRENCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`details.doCategories.${c}` as never)}
                  </option>
                ))}
              </select>
            </div>
            {draft.details.category === 'other' ? (
              <div className="space-y-1.5">
                <Label>{t('details.otherText')}</Label>
                <Input
                  value={String(draft.details.otherText ?? '')}
                  onChange={(e) => patchDetails({ otherText: e.target.value })}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {draft.kind === 'damage' || draft.kind === 'environmental' ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">
              {draft.kind === 'damage' ? t('new.damageHeading') : t('new.envHeading')}
            </h2>
            <div className="space-y-1.5">
              <Label>
                {draft.kind === 'damage' ? t('details.whatDamaged') : t('details.whatReleased')}
              </Label>
              <Input
                value={String(
                  (draft.kind === 'damage'
                    ? draft.details.whatDamaged
                    : draft.details.whatReleased) ?? '',
                )}
                onChange={(e) =>
                  patchDetails(
                    draft.kind === 'damage'
                      ? { whatDamaged: e.target.value }
                      : { whatReleased: e.target.value },
                  )
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('details.estimatedCostBand')}</Label>
              <select
                value={String(draft.details.estimatedCostBand ?? 'unknown')}
                onChange={(e) => patchDetails({ estimatedCostBand: e.target.value })}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {COST_BANDS.map((band) => (
                  <option key={band} value={band}>
                    {t(`details.costBands.${band}` as never)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>
                {draft.kind === 'damage' ? t('details.mitigation') : t('details.containment')}
              </Label>
              <Input
                value={String(
                  (draft.kind === 'damage'
                    ? draft.details.mitigation
                    : draft.details.containment) ?? '',
                )}
                onChange={(e) =>
                  patchDetails(
                    draft.kind === 'damage'
                      ? { mitigation: e.target.value }
                      : { containment: e.target.value },
                  )
                }
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── People affected ── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('new.peopleHeading')}</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  persons: [
                    ...draft.persons,
                    {
                      name: '',
                      category: 'employee',
                      bodyParts: [],
                      injuryKinds: [],
                      firstAidGiven: false,
                      hospitalisation: 'none',
                    },
                  ],
                })
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('new.addPerson')}
            </Button>
          </div>
          {draft.persons.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {needsPersonBlock ? t('new.personRequiredHint') : t('new.noPersonsHint')}
            </p>
          ) : null}
          {draft.persons.map((person, index) => (
            <div key={index} className="space-y-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={person.name}
                  onChange={(e) => {
                    const persons = [...draft.persons];
                    persons[index] = { ...person, name: e.target.value };
                    patch({ persons });
                  }}
                  placeholder={t('new.personNamePlaceholder')}
                  className="flex-1"
                />
                <select
                  value={person.category}
                  onChange={(e) => {
                    const persons = [...draft.persons];
                    persons[index] = {
                      ...person,
                      category: e.target.value as PersonDraft['category'],
                    };
                    patch({ persons });
                  }}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  {PERSON_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`personCategories.${c}` as never)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => patch({ persons: draft.persons.filter((_, i) => i !== index) })}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {needsPersonBlock ? (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    {t('new.injuryDetails')}
                  </summary>
                  <div className="mt-2 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('new.injuryKinds')}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {INJURY_KINDS.map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => {
                            const persons = [...draft.persons];
                            const has = person.injuryKinds.includes(kind);
                            persons[index] = {
                              ...person,
                              injuryKinds: has
                                ? person.injuryKinds.filter((k) => k !== kind)
                                : [...person.injuryKinds, kind],
                            };
                            patch({ persons });
                          }}
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            person.injuryKinds.includes(kind)
                              ? 'border-primary bg-primary/10 font-medium'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {t(`injuryKinds.${kind}` as never)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs font-medium text-muted-foreground">
                      {t('new.bodyParts')}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {BODY_PARTS.map((part) => (
                        <button
                          key={part}
                          type="button"
                          onClick={() => {
                            const persons = [...draft.persons];
                            const has = person.bodyParts.includes(part);
                            persons[index] = {
                              ...person,
                              bodyParts: has
                                ? person.bodyParts.filter((p) => p !== part)
                                : [...person.bodyParts, part],
                            };
                            patch({ persons });
                          }}
                          className={`rounded-full border px-2 py-0.5 text-xs ${
                            person.bodyParts.includes(part)
                              ? 'border-primary bg-primary/10 font-medium'
                              : 'text-muted-foreground'
                          }`}
                        >
                          {t(`bodyParts.${part}` as never)}
                        </button>
                      ))}
                    </div>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={person.firstAidGiven}
                        onChange={(e) => {
                          const persons = [...draft.persons];
                          persons[index] = { ...person, firstAidGiven: e.target.checked };
                          patch({ persons });
                        }}
                      />
                      {t('new.firstAidGiven')}
                    </label>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('new.hospitalisation')}
                      </p>
                      <select
                        value={person.hospitalisation}
                        onChange={(e) => {
                          const persons = [...draft.persons];
                          persons[index] = {
                            ...person,
                            hospitalisation: e.target.value as PersonDraft['hospitalisation'],
                          };
                          patch({ persons });
                        }}
                        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                      >
                        <option value="none">{t('hospitalisations.none')}</option>
                        <option value="ae">{t('hospitalisations.ae')}</option>
                        <option value="admitted">{t('hospitalisations.admitted')}</option>
                      </select>
                    </div>
                  </div>
                </details>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      {submitError !== null ? (
        <Card className="border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <CardContent className="space-y-2 p-4">
            <IncidentErrorText error={submitError} />
            <p className="text-xs text-muted-foreground">{t('new.savedLocally')}</p>
          </CardContent>
        </Card>
      ) : null}

      <Button
        type="button"
        className="w-full"
        disabled={draft.title.trim() === '' || createMutation.isPending}
        onClick={submit}
      >
        {createMutation.isPending ? t('new.submitting') : t('new.submit')}
      </Button>
    </div>
  );
}
