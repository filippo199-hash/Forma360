'use client';

/**
 * Raise a permit to work. One page, top to bottom: pick the permit type
 * (the requirements the type will enforce are shown up front), describe
 * the work, place it, set the validity window, name the acceptor. The
 * permit starts as a draft — preconditions, evidence and signatures
 * happen on the permit page before issue.
 */
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AgentDraftTrigger } from '../../../../src/components/ai/agent-draft-trigger';
import { CategoryChip } from '../../../../src/components/permits/chips';
import { PermitErrorText } from '../../../../src/components/permits/permit-error';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { SearchSelect } from '../../../../src/components/selectors/search-select';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { appConfirm } from '../../../../src/components/ui/app-confirm';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { trpc } from '../../../../src/lib/trpc/client';
import { useSubmitGuard } from '../../../../src/lib/use-submit-guard';
// Type-only import: erased at compile, so no server code reaches the bundle.
import type { PermitPreparerProposal } from '../../../../src/server/task-agents/permit-preparer';

/** Local-time value for <input type="datetime-local">. */
function toLocalInputValue(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * Compose the description textarea value from a permit-preparer proposal.
 * Precautions and the gas plan have no form field of their own (the
 * precondition checklist and gas readings only exist AFTER create,
 * snapshotted from the type onto the permit row), so they ride the
 * description as labelled sections — fully editable, and they land on
 * the permit as context for the issuer. The section headers are agent
 * CONTENT (en-GB, like the rest of the draft), not chrome — same
 * convention as seeded data. Budget: 2000 + 10×163 + ~45 + 800 ≈ 4.5k,
 * under permitCreateInput.workDescription's 5000 cap.
 */
function composeWorkDescription(p: PermitPreparerProposal, includeGasPlan: boolean): string {
  let text = p.workDescription;
  if (p.precautions.length > 0) {
    text += `\n\nPrecautions planned:\n${p.precautions.map((x) => `- ${x.text}`).join('\n')}`;
  }
  if (includeGasPlan && p.gasPlanNote !== undefined && p.gasPlanNote.trim() !== '') {
    text += `\n\nGas testing plan:\n${p.gasPlanNote}`;
  }
  return text;
}

export default function NewPermitPage() {
  const t = useTranslations('permits.new');
  const tAi = useTranslations('aiAgents');
  const { label: placeLabel } = usePlaceTerms();
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const canCreate = useHasPermission('permits.create');

  const { data: types } = trpc.permits.types.list.useQuery({});
  // Same query the SiteSelector below runs — served from the cache; used
  // to ground a proposed siteId before it reaches the form.
  const { data: siteOptions } = trpc.sites.list.useQuery();
  const { data: riskAssessmentOptions } = trpc.riskAssessments.list.useQuery({
    status: 'active',
    type: 'all',
  });

  const [typeId, setTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [workDescription, setWorkDescription] = useState('');
  const [siteId, setSiteId] = useState('');
  const [locationText, setLocationText] = useState('');
  const [validFrom, setValidFrom] = useState(() => toLocalInputValue(new Date()));
  const [validTo, setValidTo] = useState(() =>
    toLocalInputValue(new Date(Date.now() + 8 * 3_600_000)),
  );
  const [acceptorUserId, setAcceptorUserId] = useState('');
  const [acceptorKind, setAcceptorKind] = useState<'user' | 'external'>('user');
  const [acceptorName, setAcceptorName] = useState('');
  const [acceptorOrganisation, setAcceptorOrganisation] = useState('');
  const [riskAssessmentId, setRiskAssessmentId] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The AI trigger owns its sheet's open state; remounting it (key bump)
  // is the page's one lever to close the sheet after Apply, so the
  // follow-up lands the user on the filled form rather than under an
  // open overlay.
  const [aiPanelKey, setAiPanelKey] = useState(0);

  const selectedType = useMemo(() => (types ?? []).find((x) => x.id === typeId), [types, typeId]);

  const conflictsInput =
    siteId !== '' && validFrom !== '' && validTo !== ''
      ? {
          siteId,
          validFrom: new Date(validFrom),
          validTo: new Date(validTo),
          locationText,
        }
      : null;
  const { data: conflicts } = trpc.permits.checkConflicts.useQuery(
    conflictsInput ?? { validFrom: new Date(0), validTo: new Date(0) },
    { enabled: conflictsInput !== null },
  );

  const submitGuard = useSubmitGuard();
  const create = trpc.permits.create.useMutation({
    onSettled: submitGuard.release,
    onSuccess: (res) => router.push(`/${locale}/permits/${res.permitId}`),
    onError: (err) => setError(err.message),
  });

  /**
   * Apply a permit-preparer proposal onto the form. Deliberately calls
   * NO mutation: the draft is this form's state, and the user's own
   * submit runs `permits.create` exactly as today. Dates and the
   * acceptor are never touched — human decisions per ADR 0012.
   */
  async function applyPermitDraft(
    p: unknown,
  ): Promise<{ followUpLabel: string; onFollowUp: () => void }> {
    // Validated server-side by parseProposal before the SSE proposal
    // event reaches the panel — a proven boundary.
    const proposal = p as PermitPreparerProposal;
    const hasContent =
      typeId !== '' ||
      title.trim() !== '' ||
      workDescription.trim() !== '' ||
      locationText.trim() !== '' ||
      siteId !== '' ||
      riskAssessmentId !== '';
    if (hasContent) {
      // The panel sits beside a live form — never overwrite half-typed
      // input without asking (window.confirm is banned, NR3-05).
      const ok = await appConfirm({ description: tAi('panel.overwriteConfirm') });
      if (!ok) {
        // Keeps Apply available for a retry; nothing was touched. The
        // panel treats this exact message as a silent cancel.
        throw new Error('apply-cancelled');
      }
    }
    // A type id the page cannot see locally is dropped, never guessed:
    // the select falls back to "choose a type" and submit stays blocked
    // until the user picks one.
    const proposedType = (types ?? []).find((x) => x.id === proposal.permitTypeId);
    setTypeId(proposedType !== undefined ? proposal.permitTypeId : '');
    setTitle(proposal.title);
    // The gas-plan section rides only when the chosen type actually
    // requires gas testing — ranges come from the type, never invented.
    setWorkDescription(composeWorkDescription(proposal, proposedType?.requiresGasTesting === true));
    setLocationText(proposal.locationText);
    // The user just confirmed a REPLACE, so fields the proposal omits are
    // cleared, not left holding the previous job's values — and every
    // proposed id must resolve against the live tenant list or be
    // dropped (drop-don't-guess, same as permitTypeId above).
    setSiteId(
      proposal.siteId !== undefined && (siteOptions ?? []).some((s) => s.id === proposal.siteId)
        ? proposal.siteId
        : '',
    );
    setRiskAssessmentId(
      proposal.riskAssessmentId !== undefined &&
        (riskAssessmentOptions ?? []).some((ra) => ra.id === proposal.riskAssessmentId)
        ? proposal.riskAssessmentId
        : '',
    );
    setError(null);
    return {
      followUpLabel: tAi('panel.reviewForm'),
      onFollowUp: () => setAiPanelKey((k) => k + 1),
    };
  }

  function submit(): void {
    setError(null);
    if (typeId === '' || title.trim() === '') return;
    // Take the latch HERE, after every validation return: an early
    // return above would otherwise strand it and kill the button.
    if (!submitGuard.take()) return;
    create.mutate({
      permitTypeId: typeId,
      title: title.trim(),
      workDescription,
      ...(siteId !== '' ? { siteId } : {}),
      locationText,
      validFrom: new Date(validFrom),
      validTo: new Date(validTo),
      ...(acceptorKind === 'user' && acceptorUserId !== '' ? { acceptorUserId } : {}),
      ...(acceptorKind === 'external' && acceptorName.trim() !== ''
        ? {
            acceptorName: acceptorName.trim(),
            acceptorOrganisation: acceptorOrganisation.trim(),
          }
        : {}),
      ...(riskAssessmentId !== '' ? { riskAssessmentId } : {}),
    });
  }

  if (!canCreate) {
    return (
      <div className="mx-auto w-full max-w-[720px]">
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {t('noPermission')}
          </CardContent>
        </Card>
      </div>
    );
  }

  const requirementKeys: string[] = [];
  if (selectedType !== undefined) {
    if (selectedType.requiresAuthoriser) requirementKeys.push('authoriser');
    if (selectedType.requiresGasTesting) requirementKeys.push('gasTesting');
    if (selectedType.requiresIsolationCertificate) requirementKeys.push('isolationCertificate');
    if (selectedType.requiresRescuePlan) requirementKeys.push('rescuePlan');
    if (selectedType.requiresRiskAssessment) requirementKeys.push('riskAssessment');
  }

  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4 sm:space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/${locale}/permits`}
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            {t('back')}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {/* Renders nothing unless the agent passes its gates (brand,
            permits.create, tenant switch) — the trigger owns that. */}
        <AgentDraftTrigger
          key={aiPanelKey}
          agentId="permit-preparer"
          proposalSummary={
            // Validated server-side before the SSE proposal event — a
            // proven boundary.
            (p) => (p as { summary: string }).summary
          }
          applyProposal={applyPermitDraft}
        />
      </header>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="permit-type" className="font-medium">
              {t('fields.type')}
            </label>
            <select
              id="permit-type"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('fields.typePlaceholder')}</option>
              {(types ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            {selectedType !== undefined ? (
              <div className="mt-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CategoryChip category={selectedType.category} name={selectedType.name} />
                  <span className="text-xs text-muted-foreground">
                    {t('maxDuration', { hours: selectedType.maxDurationHours })}
                  </span>
                </div>
                {requirementKeys.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('willRequire')}{' '}
                    {requirementKeys.map((k) => t(`requirements.${k}` as never)).join(' · ')}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {t('preconditionCount', { count: selectedType.preconditions.length })}
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="permit-title" className="font-medium">
              {t('fields.title')}
            </label>
            <Input
              id="permit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('fields.titlePlaceholder')}
            />
          </div>

          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="permit-description" className="font-medium">
              {t('fields.description')}
            </label>
            <Textarea
              id="permit-description"
              value={workDescription}
              onChange={(e) => setWorkDescription(e.target.value)}
              rows={3}
              placeholder={t('fields.descriptionPlaceholder')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-sm">
              {/* Platform-wide hierarchical site picker (search + drill-in). */}
              <SiteSelector
                label={placeLabel}
                multiple={false}
                value={siteId !== '' ? [siteId] : []}
                onChange={(next) => setSiteId(next[0] ?? '')}
                placeholder={t('fields.noSite')}
              />
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="permit-location" className="font-medium">
                {t('fields.location')}
              </label>
              <Input
                id="permit-location"
                value={locationText}
                onChange={(e) => setLocationText(e.target.value)}
                placeholder={t('fields.locationPlaceholder')}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="permit-from" className="font-medium">
                {t('fields.validFrom')}
              </label>
              <Input
                id="permit-from"
                type="datetime-local"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="permit-to" className="font-medium">
                {t('fields.validTo')}
              </label>
              <Input
                id="permit-to"
                type="datetime-local"
                value={validTo}
                onChange={(e) => setValidTo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 text-sm">
            {/* Searchable — a live tenant can hold hundreds of assessments. */}
            <SearchSelect
              label={t('fields.riskAssessment')}
              value={riskAssessmentId !== '' ? riskAssessmentId : null}
              onChange={(next) => setRiskAssessmentId(next ?? '')}
              placeholder={t('fields.riskAssessmentPlaceholder')}
              options={(riskAssessmentOptions ?? []).map((ra) => ({
                id: ra.id,
                label: ra.title,
                sub: ra.referenceNumber,
              }))}
            />
            <p className="text-xs text-muted-foreground">{t('fields.riskAssessmentHint')}</p>
          </div>

          {/* BUG-05: the acceptor of a permit to work is normally the
              contractor doing the job, and the picker only offered
              registered users — so every tester named an internal colleague,
              which defeats the control. Either kind can be named; the
              external one signs on glass, countersigned by the issuer. */}
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={acceptorKind === 'user'}
                className={`rounded-full border px-3 py-1 text-xs ${
                  acceptorKind === 'user' ? 'bg-foreground text-background' : 'hover:bg-muted'
                }`}
                onClick={() => {
                  setAcceptorKind('user');
                  setAcceptorName('');
                  setAcceptorOrganisation('');
                }}
              >
                {t('fields.acceptorInternal')}
              </button>
              <button
                type="button"
                aria-pressed={acceptorKind === 'external'}
                className={`rounded-full border px-3 py-1 text-xs ${
                  acceptorKind === 'external' ? 'bg-foreground text-background' : 'hover:bg-muted'
                }`}
                onClick={() => {
                  setAcceptorKind('external');
                  setAcceptorUserId('');
                }}
              >
                {t('fields.acceptorExternal')}
              </button>
            </div>

            {acceptorKind === 'user' ? (
              <GroupUserSelector
                label={t('fields.acceptor')}
                mode="users"
                multiple={false}
                value={acceptorUserId !== '' ? [acceptorUserId] : []}
                onChange={(next) => setAcceptorUserId(next[0] ?? '')}
                placeholder={t('fields.acceptorPlaceholder')}
              />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="acceptor-name">{t('fields.acceptorName')}</Label>
                  <Input
                    id="acceptor-name"
                    value={acceptorName}
                    onChange={(e) => setAcceptorName(e.target.value)}
                    placeholder={t('fields.acceptorNamePlaceholder')}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="acceptor-org">{t('fields.acceptorOrganisation')}</Label>
                  <Input
                    id="acceptor-org"
                    value={acceptorOrganisation}
                    onChange={(e) => setAcceptorOrganisation(e.target.value)}
                    placeholder={t('fields.acceptorOrganisationPlaceholder')}
                  />
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t('fields.acceptorHint')}</p>
          </div>

          {(conflicts ?? []).length > 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <p className="font-medium">
                {t('conflictWarning', { count: (conflicts ?? []).length })}
              </p>
              <ul className="mt-1.5 space-y-1 text-xs">
                {(conflicts ?? []).map((c) => (
                  <li key={c.permitId}>
                    {c.referenceNumber} · {c.title} ({c.typeName})
                    {c.sameArea ? ` — ${t('sameArea')}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <PermitErrorText message={error} />

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" asChild>
              <Link href={`/${locale}/permits`}>{t('cancel')}</Link>
            </Button>
            <Button
              onClick={submit}
              disabled={typeId === '' || title.trim() === '' || create.isPending}
            >
              {t('submit')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
