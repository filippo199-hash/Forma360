'use client';

/**
 * Investigation workspace — evidence, witness statements (with the
 * platform signature pad), the RCA (five-whys chain or HSG245 causal
 * factors), findings, the conclusion block and the separated-duty
 * signatures (lead investigator submits, a different manager approves,
 * setting each finding's assignee + due date in the approval step —
 * never hard-coded). Approved revisions are frozen and stay readable;
 * the workspace edits the latest open revision.
 */
import { Camera, ChevronLeft, Download, Lock, Plus, Trash2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CAUSAL_FACTOR_CATEGORIES,
  FINDING_PRIORITIES,
  RCA_METHODS,
  RECURRENCE_LIKELIHOODS,
} from '@forma360/shared/incidents';
import { AgentDraftTrigger } from '../../../../../src/components/ai/agent-draft-trigger';
// Type-only import — erased at build, so no server code reaches the bundle.
import type { InvestigationAssistantProposal } from '../../../../../src/server/task-agents/investigation-assistant';
import { IncidentErrorText } from '../../../../../src/components/incidents/incident-error';
import { DetailNotFound } from '../../../../../src/components/detail-not-found';
import { SignaturePad } from '../../../../../src/components/inspections/signature-pad';
import { GroupUserSelector } from '../../../../../src/components/selectors/group-user-selector';
import { appConfirm } from '../../../../../src/components/ui/app-confirm';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../src/components/ui/dialog';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../../src/components/ui/tooltip';
import { TooltipIconButton } from '../../../../../src/components/ui/tooltip-icon-button';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';
import { formatDate } from '../../../../../src/lib/format-date';

interface WhyRow {
  text: string;
  isRootCause: boolean;
}
interface FactorRow {
  category: (typeof CAUSAL_FACTOR_CATEGORIES)[number];
  narrative: string;
}
interface TimelineRow {
  at: string;
  text: string;
}

export default function InvestigationWorkspacePage() {
  const t = useTranslations('incidents');
  const tAgents = useTranslations('aiAgents');
  const params = useParams<{ locale: string; incidentId: string }>();
  const router = useRouter();
  const locale = params.locale ?? 'en';
  const incidentId = params.incidentId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('incidents.manage');
  const canInvestigate = useHasPermission('incidents.investigate');
  // Administrator ⇔ org.settings (grantsAdminAccess), mirroring the server.
  const isAdmin = useHasPermission('org.settings');

  const { data, isLoading, error } = trpc.incidents.get.useQuery(
    { incidentId },
    { enabled: incidentId.length === 26 },
  );

  const [actionError, setActionError] = useState<unknown>(null);
  const [viewRevision, setViewRevision] = useState<number | null>(null);

  // RCA form state (bound to the latest open revision).
  const [method, setMethod] = useState('');
  const [immediateCause, setImmediateCause] = useState('');
  const [underlyingCause, setUnderlyingCause] = useState('');
  const [contributing, setContributing] = useState<string[]>([]);
  const [whys, setWhys] = useState<WhyRow[]>([]);
  const [factors, setFactors] = useState<FactorRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [conclusionSummary, setConclusionSummary] = useState('');
  const [rootCauseStatement, setRootCauseStatement] = useState('');
  const [recurrence, setRecurrence] = useState('');
  const [lessons, setLessons] = useState('');
  const [dirty, setDirty] = useState(false);
  const [loadedRevisionId, setLoadedRevisionId] = useState<string | null>(null);

  // Findings add form.
  const [findingCategory, setFindingCategory] = useState('procedure');
  const [findingPriority, setFindingPriority] = useState('medium');
  const [findingDescription, setFindingDescription] = useState('');
  const [findingRequiresAction, setFindingRequiresAction] = useState(true);

  // Witness form.
  const [showWitnessForm, setShowWitnessForm] = useState(false);
  const [witnessName, setWitnessName] = useState('');
  const [witnessStatement, setWitnessStatement] = useState('');
  const [witnessSignature, setWitnessSignature] = useState<string | null>(null);

  // Evidence forms.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [refKind, setRefKind] = useState<'cctv_ref' | 'physical_ref' | 'other'>('cctv_ref');
  const [refCaption, setRefCaption] = useState('');
  const [showRefForm, setShowRefForm] = useState(false);

  // Approval dialog.
  const [showApprove, setShowApprove] = useState(false);
  const [assignments, setAssignments] = useState<
    Record<string, { assignee: string[]; dueAt: string }>
  >({});
  const [rejectNote, setRejectNote] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [attested, setAttested] = useState(false);
  // IN-A8: justification for the sole-manager override.
  const [soleJustification, setSoleJustification] = useState('');

  // Access dialog (the header's people icon): the per-investigation
  // visibility circle, edited where the investigation is actually read.
  const [showAccess, setShowAccess] = useState(false);
  const [accessValue, setAccessValue] = useState<string[]>([]);

  // IN-A7: inline finding editing (pre-approval only).
  const [editingFindingId, setEditingFindingId] = useState<string | null>(null);
  const [editFinding, setEditFinding] = useState<{
    category: string;
    priority: string;
    description: string;
    requiresAction: boolean;
  }>({ category: 'procedure', priority: 'medium', description: '', requiresAction: true });

  const latest =
    data !== undefined && data.investigations.length > 0
      ? data.investigations[data.investigations.length - 1]
      : undefined;

  // Load the editable revision into the form once (or when it changes).
  useEffect(() => {
    if (latest === undefined || latest.id === loadedRevisionId) return;
    setLoadedRevisionId(latest.id);
    setMethod(latest.method ?? '');
    setImmediateCause(latest.immediateCause);
    setUnderlyingCause(latest.underlyingCause);
    setContributing([...latest.contributingFactors]);
    setWhys(latest.whyChain === null ? [] : latest.whyChain.map((w) => ({ ...w })));
    setFactors(latest.causalFactors === null ? [] : latest.causalFactors.map((f) => ({ ...f })));
    setTimeline(latest.timelineEntries.map((e) => ({ ...e })));
    setConclusionSummary(latest.conclusionSummary);
    setRootCauseStatement(latest.rootCauseStatement);
    setRecurrence(latest.recurrenceLikelihood ?? '');
    setLessons(latest.lessonsLearned);
    setDirty(false);
  }, [latest, loadedRevisionId]);

  // IN-A5: a full write-up must survive a stray gesture. While the form
  // is dirty, warn on tab close / navigation…
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  function buildSavePayload() {
    return {
      incidentId,
      method: method === '' ? null : (method as never),
      immediateCause,
      underlyingCause,
      contributingFactors: contributing as never,
      whyChain: whys.length >= 2 ? (whys as never) : null,
      causalFactors: factors.length > 0 ? (factors as never) : null,
      timelineEntries: timeline as never,
      conclusionSummary,
      rootCauseStatement,
      recurrenceLikelihood: recurrence === '' ? null : (recurrence as never),
      lessonsLearned: lessons,
    };
  }

  // …and autosave 30s after the last edit while a draft is open to the
  // viewer (same condition as the Save button; the server re-checks).
  const draftEditable =
    latest !== undefined &&
    latest.status === 'draft' &&
    ((data !== undefined && data.incident.leadInvestigatorUserId === data.viewerUserId) ||
      canManage) &&
    canInvestigate;
  useEffect(() => {
    if (!dirty || !draftEditable) return undefined;
    const timer = setTimeout(() => {
      if (!saveMutation.isPending) saveMutation.mutate(buildSavePayload());
    }, 30_000);
    return () => clearTimeout(timer);
    // Re-arm on any content edit — saves land 30s after typing stops.
  }, [
    dirty,
    draftEditable,
    method,
    immediateCause,
    underlyingCause,
    contributing,
    whys,
    factors,
    timeline,
    conclusionSummary,
    rootCauseStatement,
    recurrence,
    lessons,
  ]);

  const invalidate = async (): Promise<void> => {
    await utils.incidents.get.invalidate({ incidentId });
  };
  const mutationOpts = {
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  };

  const saveMutation = trpc.incidents.saveInvestigation.useMutation({
    onSuccess: async () => {
      setActionError(null);
      setDirty(false);
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  });
  const setParticipantsMutation = trpc.incidents.setInvestigationParticipants.useMutation({
    onSuccess: async () => {
      setActionError(null);
      setShowAccess(false);
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  });
  const submitMutation = trpc.incidents.submitInvestigation.useMutation(mutationOpts);
  const rejectMutation = trpc.incidents.rejectInvestigation.useMutation({
    onSuccess: async () => {
      setActionError(null);
      setShowReject(false);
      setRejectNote('');
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  });
  const approveMutation = trpc.incidents.approveInvestigation.useMutation({
    onSuccess: async () => {
      setActionError(null);
      setShowApprove(false);
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  });
  const addFindingMutation = trpc.incidents.addFinding.useMutation(mutationOpts);
  const removeFindingMutation = trpc.incidents.removeFinding.useMutation(mutationOpts);
  const updateFindingMutation = trpc.incidents.updateFinding.useMutation({
    onSuccess: async () => {
      setActionError(null);
      setEditingFindingId(null);
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  });
  const addWitnessMutation = trpc.incidents.addWitnessStatement.useMutation({
    onSuccess: async () => {
      setActionError(null);
      setShowWitnessForm(false);
      setWitnessName('');
      setWitnessStatement('');
      setWitnessSignature(null);
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  });
  const addEvidenceMutation = trpc.incidents.addEvidence.useMutation({
    onSuccess: async () => {
      setActionError(null);
      setShowRefForm(false);
      setRefCaption('');
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  });

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error !== null || data === undefined) {
    return (
      <div className="mx-auto w-full max-w-4xl p-6">
        {error !== null ? <DetailNotFound error={error} /> : null}
      </div>
    );
  }

  const { incident } = data;
  const nameOf = (id: string | null): string =>
    id === null ? '—' : (data.userNames[id] ?? id.slice(-6));
  const viewerIsLead = incident.leadInvestigatorUserId === data.viewerUserId;
  const editable =
    latest !== undefined &&
    latest.status === 'draft' &&
    (viewerIsLead || canManage) &&
    canInvestigate;
  // Circle edits: lead or administrator only (the server's rule —
  // `incidents.manage` is deliberately NOT enough, or a manager outside
  // the circle could add themselves and dissolve the restriction).
  // Allowed on a frozen revision too: visibility administration is not
  // investigation content.
  const canEditAccess = latest !== undefined && (viewerIsLead || isAdmin) && canInvestigate;
  const viewed =
    viewRevision === null
      ? latest
      : data.investigations.find((inv) => inv.revision === viewRevision);
  const viewingFrozen = viewed !== undefined && latest !== undefined && viewed.id !== latest.id;
  const findingsForViewed =
    viewed === undefined ? [] : data.findings.filter((f) => f.investigationId === viewed.id);
  const isFullLevel = incident.investigationLevel === 'full';

  async function uploadFiles(files: FileList): Promise<void> {
    setUploading(true);
    // IN-A4: collect per-file failures — a dropped photo must never
    // look like a success. Failed names are surfaced next to the
    // button and the files stay on the device to re-attach.
    const failed: string[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const form = new FormData();
          form.append('incidentId', incidentId);
          form.append('file', file);
          const res = await fetch('/api/upload/incident-evidence', { method: 'POST', body: form });
          if (!res.ok) {
            failed.push(file.name);
            continue;
          }
          const body = (await res.json()) as { storageKey: string; filename: string };
          await utils.client.incidents.addEvidence.mutate({
            incidentId,
            kind: file.type.startsWith('image/') ? 'photo' : 'document',
            storageKey: body.storageKey,
            filename: body.filename,
          });
        } catch {
          failed.push(file.name);
        }
      }
      await invalidate();
    } finally {
      setUploading(false);
      setUploadErrors(failed);
    }
  }

  function save(): void {
    saveMutation.mutate(buildSavePayload());
  }

  /**
   * Map an AI-drafted proposal onto the module's ordinary mutations:
   * `saveInvestigation` with ONLY the keys the proposal carries (every
   * field is optional server-side, so omitted keys leave hand-typed
   * content untouched), then one `addFinding` per proposed finding.
   * Draft-state writes only — `startInvestigation`, submission and the
   * approval signatures stay the human's existing buttons, and the
   * per-finding assignee + due date are set by the approver at approval
   * (IN-A6): `suggestedOwnerNote` / `suggestedTimescaleNote` are never
   * sent anywhere. The server re-enforces `incidents.investigate`, the
   * confidential gate, investigation authority and the frozen guard.
   */
  async function applyAgentProposal(
    proposal: unknown,
  ): Promise<{ followUpLabel: string; onFollowUp: () => void }> {
    // Validated by the agent's parseProposal Zod gate before the SSE
    // proposal event reaches the panel — a proven boundary.
    const p = proposal as InvestigationAssistantProposal;
    if (dirty) {
      // saveInvestigation overwrites the fields it is sent — a half-typed
      // local edit must survive an accidental Apply.
      const ok = await appConfirm({ description: tAgents('panel.overwriteConfirm') });
      if (!ok) throw new Error('apply-cancelled');
    }
    // Disarm the 30s autosave NOW: its closure holds pre-apply form state
    // and a stale isPending snapshot, so left armed it could fire mid-
    // apply and overwrite the applied draft with what the form held
    // before. Clearing `dirty` unmounts the timer via the effect cleanup.
    setDirty(false);
    // The page's own save hook: its onError routes the precise server
    // reason through IncidentErrorText, and its onSuccess invalidates
    // `incidents.get`. A failure here throws — nothing was written, so
    // the panel keeps Apply available for a retry.
    // Level discipline: on a BASIC investigation the workspace hides the
    // method selector, both RCA chains, the timeline and the root-cause
    // statement — AI content must never land where the lead cannot see
    // or edit it before submitting, so those keys are only sent at full
    // level. At full level the persisted analysis must match its method:
    // the chain the proposal's method does NOT use is cleared explicitly
    // (nullable server-side), so a method switch cannot leave a
    // contradictory chain behind in a statutory record.
    await saveMutation.mutateAsync({
      incidentId,
      ...(isFullLevel
        ? {
            method: p.method,
            // The chain the method USES: written when proposed, left
            // untouched when the proposal omits it (a conclusion-only
            // refine must not destroy an existing chain). The chain the
            // method does NOT use is always cleared.
            ...(p.method === 'five_whys'
              ? { ...(p.whyChain !== undefined ? { whyChain: p.whyChain } : {}) }
              : { whyChain: null }),
            ...(p.method === 'causal_factors'
              ? { ...(p.causalFactors !== undefined ? { causalFactors: p.causalFactors } : {}) }
              : { causalFactors: null }),
            ...(p.timelineEntries !== undefined ? { timelineEntries: p.timelineEntries } : {}),
            ...(p.rootCauseStatement !== undefined
              ? { rootCauseStatement: p.rootCauseStatement }
              : {}),
          }
        : {}),
      ...(p.immediateCause !== undefined ? { immediateCause: p.immediateCause } : {}),
      ...(p.underlyingCause !== undefined ? { underlyingCause: p.underlyingCause } : {}),
      ...(p.contributingFactors !== undefined
        ? { contributingFactors: p.contributingFactors }
        : {}),
      ...(p.conclusionSummary !== undefined ? { conclusionSummary: p.conclusionSummary } : {}),
      ...(p.recurrenceLikelihood !== undefined
        ? { recurrenceLikelihood: p.recurrenceLikelihood }
        : {}),
      ...(p.lessonsLearned !== undefined ? { lessonsLearned: p.lessonsLearned } : {}),
    });
    // addFinding has no idempotency key, so a Refine → Apply cycle would
    // append duplicates: diff against the live cache's findings for the
    // open revision by description before adding, and keep going past a
    // single failure — the investigation draft already exists.
    const fresh = utils.incidents.get.getData({ incidentId });
    const freshLatest =
      fresh !== undefined && fresh.investigations.length > 0
        ? fresh.investigations[fresh.investigations.length - 1]
        : undefined;
    const existingDescriptions = new Set(
      (fresh?.findings ?? [])
        .filter((f) => freshLatest !== undefined && f.investigationId === freshLatest.id)
        .map((f) => f.description.trim().toLowerCase()),
    );
    let incomplete = false;
    for (const finding of p.findings) {
      if (existingDescriptions.has(finding.description.trim().toLowerCase())) continue;
      try {
        await addFindingMutation.mutateAsync({
          incidentId,
          category: finding.category,
          priority: finding.priority,
          description: finding.description,
          requiresAction: finding.requiresAction,
        });
      } catch {
        incomplete = true;
      }
    }
    if (incomplete) toast.error(tAgents('panel.partialApplyToast'));
    // Re-seed the form from the refetched record so the applied content
    // is what the workspace shows (the revision id did not change, so
    // the load-once effect must be re-armed explicitly).
    setLoadedRevisionId(null);
    setDirty(false);
    return {
      followUpLabel: tAgents('panel.openDraft'),
      onFollowUp: () => router.push(`/${locale}/incidents/${incidentId}/investigation`),
    };
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={`/${locale}/incidents/${incidentId}`}>
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{t('workspace.title')}</h1>
            <p className="text-xs text-muted-foreground">
              {incident.referenceNumber}
              {incident.confidential ? ` · ${t('list.confidential')}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Who can read this investigation — edited where it is
              actually read. Reserved for the lead and administrators,
              mirroring `setInvestigationParticipants`; everyone else
              sees it disabled with the reason rather than not at all.
              Platform tooltips, not native title — the OS delay made
              these icons read as unlabelled (review round 4). A disabled
              button swallows hover, so its trigger is a focusable span. */}
          {canEditAccess ? (
            <TooltipIconButton
              icon={Users}
              label={t('access.title')}
              onClick={() => {
                setAccessValue([...(latest?.participantUserIds ?? [])]);
                setShowAccess(true);
              }}
            />
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  role="img"
                  aria-label={t('access.leadOnly')}
                  className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-md text-muted-foreground/50"
                >
                  <Users className="h-4 w-4" aria-hidden />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('access.leadOnly')}</TooltipContent>
            </Tooltip>
          )}
          {/* The whole investigation as one document (the incident PDF
              carries every revision). Server-gated: an outsider to the
              visibility circle is refused there, so this is hidden
              rather than left to 403 in a new tab. */}
          {!data.investigationRestricted ? (
            <TooltipIconButton
              icon={Download}
              label={t('workspace.downloadInvestigation')}
              href={`/api/exports/incident-pdf?incidentId=${incidentId}`}
              target="_blank"
            />
          ) : null}
          {/* The workspace-level entry point (AGS-16): parked on the RCA
              card it understated its reach — Apply also writes the
              chronology, conclusion and findings, so the button belongs
              to the whole workspace. Mounted only over an OPEN draft
              revision the viewer may edit (`editable` mirrors
              assertInvestigationAuthority client-side for UX; the server
              re-checks). Apply never calls startInvestigation — opening
              a revision stays the human's button on the incident page. */}
          {editable ? (
            <AgentDraftTrigger
              agentId="investigation-assistant"
              params={{ incidentId }}
              proposalSummary={(p) =>
                /* validated server-side before the SSE proposal
                   event — a proven boundary */
                (p as { summary: string }).summary
              }
              applyProposal={applyAgentProposal}
            />
          ) : null}
          {data.investigations.length > 1 ? (
            <select
              value={viewRevision ?? latest?.revision ?? 1}
              onChange={(e) => {
                const rev = Number(e.target.value);
                setViewRevision(rev === latest?.revision ? null : rev);
              }}
              className="h-9 rounded-md border bg-background px-2 text-sm"
            >
              {data.investigations.map((inv) => (
                <option key={inv.id} value={inv.revision}>
                  {t('workspace.revisionOption', {
                    revision: inv.revision,
                    // IN-A14: translated status, not the raw enum.
                    status: t(`investigation.statuses.${inv.status}` as never),
                  })}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      {actionError !== null ? <IncidentErrorText error={actionError} /> : null}
      {/* Visibility circle — a read-only reminder; editing lives on the
          incident page's Investigation card. */}
      {latest?.participantUserIds != null ? (
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" />
          {t('investigation.restrictedTo', { count: latest.participantUserIds.length })}
          {': '}
          {latest.participantUserIds.map((id) => nameOf(id)).join(', ')}
        </p>
      ) : null}
      {viewed === undefined ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {data.investigationRestricted
              ? t('investigation.restricted')
              : t('workspace.noInvestigation')}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Frozen revision — rendered in FULL (IN-A9b): the approved
             analysis is the legally significant artefact, so nothing the
             PDF prints is hidden on screen. ── */}
      {viewed !== undefined && viewingFrozen ? (
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            <p className="text-xs font-medium text-muted-foreground">
              {t('workspace.frozenNote', {
                revision: viewed.revision,
                date: viewed.approvedAt !== null ? formatDate(viewed.approvedAt, locale) : '—',
              })}
            </p>
            {viewed.method !== null ? (
              <p>
                <span className="text-muted-foreground">{t('workspace.method')}: </span>
                {t(`workspace.methods.${viewed.method}` as never)}
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">{t('workspace.immediateCause')}: </span>
              {viewed.immediateCause || '—'}
            </p>
            <p>
              <span className="text-muted-foreground">{t('workspace.underlyingCause')}: </span>
              {viewed.underlyingCause || '—'}
            </p>
            {viewed.contributingFactors.length > 0 ? (
              <p>
                <span className="text-muted-foreground">
                  {t('workspace.contributingFactors')}:{' '}
                </span>
                {viewed.contributingFactors
                  .map((c) => t(`causalFactors.${c}` as never))
                  .join(' · ')}
              </p>
            ) : null}
            {viewed.whyChain !== null && viewed.whyChain.length > 0 ? (
              <div>
                <p className="text-muted-foreground">{t('workspace.whyChainHeading')}</p>
                <ol className="ml-4 list-decimal space-y-0.5">
                  {viewed.whyChain.map((w, i) => (
                    <li key={i} className={w.isRootCause ? 'font-medium' : ''}>
                      {w.text}
                      {w.isRootCause ? ` — ${t('workspace.rootCauseMark')}` : ''}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {viewed.causalFactors !== null && viewed.causalFactors.length > 0 ? (
              <div>
                <p className="text-muted-foreground">{t('workspace.causalFactorsHeading')}</p>
                <ul className="ml-4 list-disc space-y-0.5">
                  {viewed.causalFactors.map((f, i) => (
                    <li key={i}>
                      <span className="font-medium">
                        {t(`causalFactors.${f.category}` as never)}
                      </span>
                      : {f.narrative}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {viewed.timelineEntries.length > 0 ? (
              <div>
                <p className="text-muted-foreground">{t('workspace.timelineHeading')}</p>
                <ul className="ml-4 list-disc space-y-0.5">
                  {viewed.timelineEntries.map((entry, i) => (
                    <li key={i}>
                      {entry.at !== '' ? `${entry.at} — ` : ''}
                      {entry.text}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {viewed.conclusionSummary !== '' ? (
              <div>
                <p className="text-muted-foreground">{t('workspace.conclusionSummary')}</p>
                <p className="whitespace-pre-wrap border-l-2 pl-3">{viewed.conclusionSummary}</p>
              </div>
            ) : null}
            {viewed.rootCauseStatement !== '' ? (
              <p>
                <span className="text-muted-foreground">{t('workspace.rootCauseStatement')}: </span>
                {viewed.rootCauseStatement}
              </p>
            ) : null}
            {viewed.recurrenceLikelihood !== null ? (
              <p>
                <span className="text-muted-foreground">
                  {t('workspace.recurrenceLikelihood')}:{' '}
                </span>
                {t(`workspace.recurrence.${viewed.recurrenceLikelihood}` as never)}
              </p>
            ) : null}
            {viewed.lessonsLearned !== '' ? (
              <p>
                <span className="text-muted-foreground">{t('workspace.lessonsLearned')}: </span>
                {viewed.lessonsLearned}
              </p>
            ) : null}
            {findingsForViewed.length > 0 ? (
              <div>
                <p className="text-muted-foreground">{t('workspace.findingsHeading')}</p>
                <ul className="ml-4 list-disc space-y-0.5">
                  {findingsForViewed.map((finding) => (
                    <li key={finding.id}>
                      {finding.description}
                      <span className="text-xs text-muted-foreground">
                        {' '}
                        · {t(`causalFactors.${finding.category}` as never)} ·{' '}
                        {t(`priorities.${finding.priority}` as never)}
                        {finding.requiresAction ? ` · ${t('workspace.requiresAction')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="border-t pt-2 text-xs text-muted-foreground">
              {t('workspace.signatures', {
                submitted: nameOf(viewed.submittedByUserId),
                approved: nameOf(viewed.approvedByUserId),
              })}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Editable workspace (latest revision) ── */}
      {latest !== undefined && !viewingFrozen ? (
        <>
          {/* Evidence */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('workspace.evidenceHeading')}</h2>
                {canInvestigate || canManage ? (
                  <div className="flex gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*,video/mp4,video/quicktime,video/webm,video/3gpp,video/3gpp2,video/x-matroska,video/x-m4v,.3gp,.3g2,.mkv,.m4v,application/pdf"
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
                      size="sm"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera className="mr-1 h-3.5 w-3.5" />
                      {uploading ? t('new.uploading') : t('workspace.addFiles')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowRefForm(!showRefForm)}
                    >
                      {t('workspace.addReference')}
                    </Button>
                  </div>
                ) : null}
              </div>
              {uploadErrors.length > 0 ? (
                <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {t('workspace.uploadFailed', { files: uploadErrors.join(', ') })}
                </p>
              ) : null}
              {showRefForm ? (
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('workspace.referenceKind')}</Label>
                    <select
                      value={refKind}
                      onChange={(e) => setRefKind(e.target.value as typeof refKind)}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="cctv_ref">{t('evidenceKinds.cctv_ref')}</option>
                      <option value="physical_ref">{t('evidenceKinds.physical_ref')}</option>
                      <option value="other">{t('evidenceKinds.other')}</option>
                    </select>
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">{t('workspace.referenceCaption')}</Label>
                    <Input
                      value={refCaption}
                      onChange={(e) => setRefCaption(e.target.value)}
                      placeholder={t('workspace.referenceCaptionPlaceholder')}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={refCaption.trim() === '' || addEvidenceMutation.isPending}
                    onClick={() =>
                      addEvidenceMutation.mutate({
                        incidentId,
                        kind: refKind,
                        caption: refCaption.trim(),
                      })
                    }
                  >
                    {t('common.save')}
                  </Button>
                </div>
              ) : null}
              {data.evidence.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('workspace.noEvidence')}</p>
              ) : (
                <div className="space-y-1">
                  {data.evidence.map((item) => (
                    <div key={item.id} className="flex items-baseline gap-2 text-sm">
                      <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t(`evidenceKinds.${item.kind}` as never)}
                      </span>
                      <span>{item.filename ?? item.caption}</span>
                      {item.filename !== null && item.caption !== '' ? (
                        <span className="text-xs text-muted-foreground">{item.caption}</span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {nameOf(item.collectedByUserId)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Witness statements */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('workspace.witnessHeading')}</h2>
                {(canInvestigate || canManage) && !showWitnessForm ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowWitnessForm(true)}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    {t('workspace.addStatement')}
                  </Button>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">{t('workspace.appendOnlyNote')}</p>
              {showWitnessForm ? (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="space-y-1.5">
                    <Label>{t('workspace.witnessName')}</Label>
                    <Input value={witnessName} onChange={(e) => setWitnessName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('workspace.statement')}</Label>
                    <Textarea
                      value={witnessStatement}
                      onChange={(e) => setWitnessStatement(e.target.value)}
                      rows={4}
                    />
                  </div>
                  {witnessSignature === null ? (
                    <SignaturePad
                      defaultName={witnessName}
                      onSave={({ signatureData }) => setWitnessSignature(signatureData)}
                    />
                  ) : (
                    <p className="text-xs text-emerald-700 dark:text-emerald-300">
                      {t('workspace.signatureCaptured')}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={
                        witnessName.trim() === '' ||
                        witnessStatement.trim() === '' ||
                        addWitnessMutation.isPending
                      }
                      onClick={() =>
                        addWitnessMutation.mutate({
                          incidentId,
                          witnessName: witnessName.trim(),
                          statement: witnessStatement.trim(),
                          ...(witnessSignature !== null ? { signatureData: witnessSignature } : {}),
                        })
                      }
                    >
                      {t('workspace.saveStatement')}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setShowWitnessForm(false)}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : null}
              {data.witnesses.map((witness) => (
                <div key={witness.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">
                    {witness.witnessName}
                    {witness.signatureData !== null ? (
                      <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-300">
                        {t('workspace.signed')}
                      </span>
                    ) : null}
                  </p>
                  <p className="whitespace-pre-wrap text-muted-foreground">{witness.statement}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('workspace.takenBy', { name: nameOf(witness.takenByUserId) })}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* RCA */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t('workspace.rcaHeading')}</h2>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('workspace.immediateCause')}</Label>
                  <Textarea
                    value={immediateCause}
                    disabled={!editable}
                    onChange={(e) => {
                      setImmediateCause(e.target.value);
                      setDirty(true);
                    }}
                    rows={2}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('workspace.underlyingCause')}</Label>
                  <Textarea
                    value={underlyingCause}
                    disabled={!editable}
                    onChange={(e) => {
                      setUnderlyingCause(e.target.value);
                      setDirty(true);
                    }}
                    rows={2}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('workspace.contributingFactors')}</Label>
                <div className="flex flex-wrap gap-1">
                  {CAUSAL_FACTOR_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      type="button"
                      disabled={!editable}
                      onClick={() => {
                        setContributing((prev) =>
                          prev.includes(category)
                            ? prev.filter((c) => c !== category)
                            : [...prev, category],
                        );
                        setDirty(true);
                      }}
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        contributing.includes(category)
                          ? 'border-primary bg-primary/10 font-medium'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {t(`causalFactors.${category}` as never)}
                    </button>
                  ))}
                </div>
              </div>

              {isFullLevel ? (
                <>
                  <div className="space-y-1.5">
                    <Label>{t('workspace.method')}</Label>
                    <select
                      value={method}
                      disabled={!editable}
                      onChange={(e) => {
                        setMethod(e.target.value);
                        setDirty(true);
                      }}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">—</option>
                      {RCA_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {t(`workspace.methods.${m}` as never)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {method === 'five_whys' ? (
                    <div className="space-y-2">
                      {whys.map((why, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="w-6 shrink-0 text-xs text-muted-foreground">
                            {index + 1}.
                          </span>
                          <Input
                            value={why.text}
                            disabled={!editable}
                            onChange={(e) => {
                              const next = [...whys];
                              next[index] = { ...why, text: e.target.value };
                              setWhys(next);
                              setDirty(true);
                            }}
                            placeholder={t('workspace.whyPlaceholder')}
                          />
                          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              disabled={!editable || index !== whys.length - 1}
                              checked={why.isRootCause}
                              onChange={(e) => {
                                const next = whys.map((w, i) => ({
                                  ...w,
                                  isRootCause: i === index ? e.target.checked : false,
                                }));
                                setWhys(next);
                                setDirty(true);
                              }}
                            />
                            {t('workspace.rootCause')}
                          </label>
                          {editable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setWhys(whys.filter((_, i) => i !== index));
                                setDirty(true);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                      {editable && whys.length < 7 ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setWhys([...whys, { text: '', isRootCause: false }]);
                            setDirty(true);
                          }}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          {t('workspace.addWhy')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {method === 'causal_factors' ? (
                    <div className="space-y-2">
                      {factors.map((factor, index) => (
                        <div key={index} className="flex items-start gap-2">
                          <select
                            value={factor.category}
                            disabled={!editable}
                            onChange={(e) => {
                              const next = [...factors];
                              next[index] = {
                                ...factor,
                                category: e.target.value as FactorRow['category'],
                              };
                              setFactors(next);
                              setDirty(true);
                            }}
                            className="h-9 w-44 shrink-0 rounded-md border bg-background px-2 text-sm"
                          >
                            {CAUSAL_FACTOR_CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {t(`causalFactors.${c}` as never)}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={factor.narrative}
                            disabled={!editable}
                            onChange={(e) => {
                              const next = [...factors];
                              next[index] = { ...factor, narrative: e.target.value };
                              setFactors(next);
                              setDirty(true);
                            }}
                            placeholder={t('workspace.factorNarrativePlaceholder')}
                          />
                          {editable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setFactors(factors.filter((_, i) => i !== index));
                                setDirty(true);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                      {editable ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setFactors([...factors, { category: 'procedure', narrative: '' }]);
                            setDirty(true);
                          }}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          {t('workspace.addFactor')}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Timeline entries */}
                  <div className="space-y-2">
                    <Label>{t('workspace.timelineHeading')}</Label>
                    {timeline.map((entry, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          value={entry.at}
                          disabled={!editable}
                          onChange={(e) => {
                            const next = [...timeline];
                            next[index] = { ...entry, at: e.target.value };
                            setTimeline(next);
                            setDirty(true);
                          }}
                          placeholder={t('workspace.timelineWhen')}
                          className="w-36 shrink-0"
                        />
                        <Input
                          value={entry.text}
                          disabled={!editable}
                          onChange={(e) => {
                            const next = [...timeline];
                            next[index] = { ...entry, text: e.target.value };
                            setTimeline(next);
                            setDirty(true);
                          }}
                          placeholder={t('workspace.timelineWhat')}
                        />
                        {editable ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setTimeline(timeline.filter((_, i) => i !== index));
                              setDirty(true);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </div>
                    ))}
                    {editable ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setTimeline([...timeline, { at: '', text: '' }]);
                          setDirty(true);
                        }}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {t('workspace.addTimelineRow')}
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          {/* Findings */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">{t('workspace.findingsHeading')}</h2>
              {findingsForViewed.map((finding) =>
                editingFindingId === finding.id ? (
                  /* IN-A7: pre-approval finding correction. */
                  <div key={finding.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex flex-wrap gap-2">
                      <select
                        value={editFinding.category}
                        onChange={(e) =>
                          setEditFinding({ ...editFinding, category: e.target.value })
                        }
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                      >
                        {CAUSAL_FACTOR_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {t(`causalFactors.${c}` as never)}
                          </option>
                        ))}
                      </select>
                      <select
                        value={editFinding.priority}
                        onChange={(e) =>
                          setEditFinding({ ...editFinding, priority: e.target.value })
                        }
                        className="h-9 rounded-md border bg-background px-2 text-sm"
                      >
                        {FINDING_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {t(`priorities.${p}` as never)}
                          </option>
                        ))}
                      </select>
                      <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={editFinding.requiresAction}
                          onChange={(e) =>
                            setEditFinding({ ...editFinding, requiresAction: e.target.checked })
                          }
                        />
                        {t('workspace.requiresAction')}
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={editFinding.description}
                        onChange={(e) =>
                          setEditFinding({ ...editFinding, description: e.target.value })
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          editFinding.description.trim() === '' || updateFindingMutation.isPending
                        }
                        onClick={() =>
                          updateFindingMutation.mutate({
                            incidentId,
                            findingId: finding.id,
                            category: editFinding.category as never,
                            priority: editFinding.priority as never,
                            description: editFinding.description.trim(),
                            requiresAction: editFinding.requiresAction,
                          })
                        }
                      >
                        {t('common.save')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingFindingId(null)}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={finding.id}
                    className="flex items-start justify-between gap-2 rounded-md border p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{finding.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {t(`causalFactors.${finding.category}` as never)} ·{' '}
                        {t(`priorities.${finding.priority}` as never)}
                        {finding.requiresAction ? ` · ${t('workspace.requiresAction')}` : ''}
                      </p>
                    </div>
                    {editable && finding.actionId === null ? (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingFindingId(finding.id);
                            setEditFinding({
                              category: finding.category,
                              priority: finding.priority,
                              description: finding.description,
                              requiresAction: finding.requiresAction,
                            });
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            removeFindingMutation.mutate({ incidentId, findingId: finding.id })
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ),
              )}
              {editable ? (
                <div className="space-y-2 rounded-md border p-3">
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={findingCategory}
                      onChange={(e) => setFindingCategory(e.target.value)}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      {CAUSAL_FACTOR_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {t(`causalFactors.${c}` as never)}
                        </option>
                      ))}
                    </select>
                    <select
                      value={findingPriority}
                      onChange={(e) => setFindingPriority(e.target.value)}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      {FINDING_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {t(`priorities.${p}` as never)}
                        </option>
                      ))}
                    </select>
                    <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={findingRequiresAction}
                        onChange={(e) => setFindingRequiresAction(e.target.checked)}
                      />
                      {t('workspace.requiresAction')}
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={findingDescription}
                      onChange={(e) => setFindingDescription(e.target.value)}
                      placeholder={t('workspace.findingPlaceholder')}
                    />
                    <Button
                      type="button"
                      disabled={findingDescription.trim() === '' || addFindingMutation.isPending}
                      onClick={() => {
                        addFindingMutation.mutate({
                          incidentId,
                          category: findingCategory as never,
                          priority: findingPriority as never,
                          description: findingDescription.trim(),
                          requiresAction: findingRequiresAction,
                        });
                        setFindingDescription('');
                      }}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* Conclusion + signatures */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-semibold">{t('workspace.conclusionHeading')}</h2>
              <div className="space-y-1.5">
                <Label>{t('workspace.conclusionSummary')}</Label>
                <Textarea
                  value={conclusionSummary}
                  disabled={!editable}
                  onChange={(e) => {
                    setConclusionSummary(e.target.value);
                    setDirty(true);
                  }}
                  rows={3}
                />
              </div>
              {isFullLevel ? (
                <div className="space-y-1.5">
                  <Label>{t('workspace.rootCauseStatement')}</Label>
                  <Textarea
                    value={rootCauseStatement}
                    disabled={!editable}
                    onChange={(e) => {
                      setRootCauseStatement(e.target.value);
                      setDirty(true);
                    }}
                    rows={2}
                  />
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t('workspace.recurrenceLikelihood')}</Label>
                  <select
                    value={recurrence}
                    disabled={!editable}
                    onChange={(e) => {
                      setRecurrence(e.target.value);
                      setDirty(true);
                    }}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="">—</option>
                    {RECURRENCE_LIKELIHOODS.map((r) => (
                      <option key={r} value={r}>
                        {t(`workspace.recurrence.${r}` as never)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('workspace.lessonsLearned')}</Label>
                  <Textarea
                    value={lessons}
                    disabled={!editable}
                    onChange={(e) => {
                      setLessons(e.target.value);
                      setDirty(true);
                    }}
                    rows={2}
                  />
                </div>
              </div>

              {editable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant={dirty ? 'default' : 'outline'}
                    disabled={saveMutation.isPending}
                    onClick={save}
                  >
                    {saveMutation.isPending ? t('common.saving') : t('common.save')}
                  </Button>
                  {viewerIsLead || canManage ? (
                    <div className="flex items-center gap-2">
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={attested}
                          onChange={(e) => setAttested(e.target.checked)}
                        />
                        {t('workspace.attestation')}
                      </label>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!attested || dirty || submitMutation.isPending}
                        onClick={() => submitMutation.mutate({ incidentId })}
                      >
                        {t('workspace.submit')}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {latest.status === 'submitted' ? (
                <div className="space-y-3 rounded-md border p-3">
                  <p className="text-sm">
                    {t('workspace.submittedBy', {
                      name: nameOf(latest.submittedByUserId),
                    })}
                  </p>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" onClick={() => setShowApprove(!showApprove)}>
                        {t('workspace.approve')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowReject(!showReject)}
                      >
                        {t('workspace.reject')}
                      </Button>
                    </div>
                  ) : null}
                  {showReject ? (
                    <div className="space-y-2">
                      <Textarea
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder={t('workspace.rejectNotePlaceholder')}
                        rows={2}
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={rejectNote.trim() === '' || rejectMutation.isPending}
                        onClick={() =>
                          rejectMutation.mutate({ incidentId, note: rejectNote.trim() })
                        }
                      >
                        {t('workspace.confirmReject')}
                      </Button>
                    </div>
                  ) : null}
                  {showApprove
                    ? (() => {
                        // IN-A6: every action-bearing finding needs an
                        // owner before the confirm button unlocks — an
                        // unassigned action can never be chased.
                        const pendingFindings = findingsForViewed.filter(
                          (f) => f.requiresAction && f.actionId === null,
                        );
                        const allAssigned = pendingFindings.every(
                          (f) => assignments[f.id]?.assignee[0] !== undefined,
                        );
                        // IN-A8: the conflicted approver path — server
                        // permits it only when nobody independent exists.
                        const viewerConflicted =
                          data.viewerUserId === incident.leadInvestigatorUserId ||
                          data.viewerUserId === latest.submittedByUserId;
                        return (
                          <div className="space-y-3">
                            <p className="text-xs text-muted-foreground">
                              {t('workspace.approveHint')}
                            </p>
                            {pendingFindings.map((finding) => {
                              const assignment = assignments[finding.id] ?? {
                                assignee: [],
                                dueAt: '',
                              };
                              return (
                                <div key={finding.id} className="space-y-2 rounded-md border p-3">
                                  <p className="text-sm font-medium">{finding.description}</p>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <GroupUserSelector
                                      value={assignment.assignee}
                                      onChange={(next) =>
                                        setAssignments({
                                          ...assignments,
                                          [finding.id]: { ...assignment, assignee: next },
                                        })
                                      }
                                      mode="users"
                                      multiple={false}
                                      label={`${t('workspace.assignee')} *`}
                                      placeholder={t('workspace.assigneePlaceholder')}
                                    />
                                    <div className="space-y-1.5">
                                      <Label>{t('workspace.dueDate')}</Label>
                                      <Input
                                        type="date"
                                        value={assignment.dueAt}
                                        onChange={(e) =>
                                          setAssignments({
                                            ...assignments,
                                            [finding.id]: { ...assignment, dueAt: e.target.value },
                                          })
                                        }
                                      />
                                      <p className="text-xs text-muted-foreground">
                                        {t('workspace.dueDateAutoHint')}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {!allAssigned ? (
                              <p className="text-xs text-amber-700 dark:text-amber-300">
                                {t('workspace.assignAllHint')}
                              </p>
                            ) : null}
                            {viewerConflicted ? (
                              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
                                <p className="text-xs text-amber-900 dark:text-amber-200">
                                  {t('workspace.soleManagerNotice')}
                                </p>
                                <Textarea
                                  value={soleJustification}
                                  onChange={(e) => setSoleJustification(e.target.value)}
                                  placeholder={t('workspace.soleManagerPlaceholder')}
                                  rows={2}
                                />
                              </div>
                            ) : null}
                            <Button
                              type="button"
                              disabled={
                                approveMutation.isPending ||
                                !allAssigned ||
                                (viewerConflicted && soleJustification.trim() === '')
                              }
                              onClick={() =>
                                approveMutation.mutate({
                                  incidentId,
                                  assignments: Object.entries(assignments).map(
                                    ([findingId, assignment]) => ({
                                      findingId,
                                      ...(assignment.assignee[0] !== undefined
                                        ? { assigneeUserId: assignment.assignee[0] }
                                        : {}),
                                      ...(assignment.dueAt !== ''
                                        ? { dueAt: new Date(assignment.dueAt) }
                                        : {}),
                                    }),
                                  ),
                                  ...(viewerConflicted && soleJustification.trim() !== ''
                                    ? { soleManagerJustification: soleJustification.trim() }
                                    : {}),
                                })
                              }
                            >
                              {t('workspace.confirmApprove')}
                            </Button>
                          </div>
                        );
                      })()
                    : null}
                </div>
              ) : null}

              {latest.status === 'approved' ? (
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  {t('workspace.approvedNote', {
                    name: nameOf(latest.approvedByUserId),
                  })}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* Who can read this investigation. Person-by-person, so a lead can
          keep a sensitive thread to the people actually working it. An
          empty circle means unrestricted — the same semantics the server
          stores (null), stated in words so nobody has to infer it. */}
      <Dialog open={showAccess} onOpenChange={setShowAccess}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('access.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('access.hint')}</p>
            <GroupUserSelector
              value={accessValue}
              onChange={setAccessValue}
              mode="users"
              multiple
              label={t('investigation.participants')}
              placeholder={t('investigation.participantsPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">
              {accessValue.length === 0 ? t('access.unrestrictedNote') : t('access.alwaysNote')}
            </p>
          </div>
          <DialogFooter>
            {latest?.participantUserIds != null ? (
              <Button
                type="button"
                variant="outline"
                disabled={setParticipantsMutation.isPending}
                onClick={() =>
                  setParticipantsMutation.mutate({ incidentId, participantUserIds: null })
                }
              >
                {t('investigation.removeRestriction')}
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={setParticipantsMutation.isPending}
              onClick={() =>
                setParticipantsMutation.mutate({
                  incidentId,
                  participantUserIds: accessValue.length === 0 ? null : accessValue,
                })
              }
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
