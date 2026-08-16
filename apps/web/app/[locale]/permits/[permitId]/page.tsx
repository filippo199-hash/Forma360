'use client';

/**
 * The permit page — one screen from draft to closure.
 *
 * Top to bottom it mirrors how a paper permit is worked: the header
 * states what, where and when; the SIMOPs banner warns about clashing
 * work; the precondition checklist and evidence records gate the issue;
 * the signature strip carries authorise → issue → accept; the action bar
 * exposes exactly the lifecycle moves the current status allows; the
 * timeline is the append-only audit trail.
 */
import {
  ArrowLeft,
  Check,
  FileDown,
  FileText,
  LogIn,
  LogOut,
  Paperclip,
  Users,
  Wind,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  CategoryChip,
  CountdownChip,
  PermitStatusChip,
} from '../../../../src/components/permits/chips';
import {
  PermitErrorText,
  usePermitErrorText,
} from '../../../../src/components/permits/permit-error';
import { formatIsoDatesInText } from '../../../../src/components/permits/event-detail';
import {
  GAS_READING_BOUNDS,
  resolveGasReadingDraft,
} from '../../../../src/components/permits/gas-reading-form';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { SearchSelect } from '../../../../src/components/selectors/search-select';
import { DetailNotFound } from '../../../../src/components/detail-not-found';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Checkbox } from '../../../../src/components/ui/checkbox';
import { Input } from '../../../../src/components/ui/input';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { enqueueOffline, isNetworkError } from '../../../../src/lib/offline-queue';
import { toast } from 'sonner';
import { trpc } from '../../../../src/lib/trpc/client';

/** Local-time value for <input type="datetime-local">. */
function toLocalInputValue(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const GAS_UNIT_LABELS: Record<string, string> = {
  percent_lel: '% LEL',
  percent_o2: '% O₂',
  ppm: 'ppm',
  mg_m3: 'mg/m³',
};

type PanelKey = 'suspend' | 'resume' | 'extend' | 'handover' | 'close' | 'cancel' | null;

/** Human form of a gas limit's acceptable range. */
function limitRangeLabel(limit: { min: number | null; max: number | null; unit: string }): string {
  const unit = GAS_UNIT_LABELS[limit.unit] ?? limit.unit;
  if (limit.min !== null && limit.max !== null) return `${limit.min}–${limit.max} ${unit}`;
  if (limit.max !== null) return `≤ ${limit.max} ${unit}`;
  if (limit.min !== null) return `≥ ${limit.min} ${unit}`;
  return unit;
}

export default function PermitDetailPage() {
  const t = useTranslations('permits.detail');
  const tOffline = useTranslations('offline');
  const tCommon = useTranslations('common');
  const permitErrorText = usePermitErrorText();
  const params = useParams<{ locale: string; permitId: string }>();
  const locale = params.locale ?? 'en';
  const permitId = params.permitId ?? '';

  const canIssue = useHasPermission('permits.issue');
  const canCreate = useHasPermission('permits.create');

  const utils = trpc.useUtils();
  const {
    data: permit,
    isLoading,
    error: loadError,
  } = trpc.permits.get.useQuery({ permitId }, { enabled: permitId.length === 26 });
  const { data: riskAssessmentOptions } = trpc.riskAssessments.list.useQuery(
    { status: 'active', type: 'all' },
    { enabled: permit?.status === 'draft' },
  );
  const { data: documentOptions } = trpc.documents.list.useQuery(
    {},
    { enabled: permit?.status === 'draft' },
  );
  // BUG-05: the acceptor is editable while the permit is a draft.
  const { data: acceptorOptions } = trpc.users.list.useQuery(
    {},
    { enabled: permit?.status === 'draft' },
  );

  const [error, setError] = useState<string | null>(null);
  /**
   * BUG-13: each precondition tick used to wait a full round trip before the
   * box changed, so clicking several quickly read the STALE server value and
   * sent the opposite intent — the audit history logged
   * "confirmed → unconfirmed → confirmed" for boxes the user ticked once,
   * and the click that appeared to do nothing got clicked again. This holds
   * the intent locally until the server catches up, so what is on screen is
   * always what the user last pressed.
   */
  const [pendingChecks, setPendingChecks] = useState<Record<string, boolean>>({});
  const [panel, setPanel] = useState<PanelKey>(null);
  const [acknowledgeConflicts, setAcknowledgeConflicts] = useState(false);

  // Action-panel state.
  const [reason, setReason] = useState('');
  const [confirmResume, setConfirmResume] = useState(false);
  const [newValidTo, setNewValidTo] = useState('');
  const [extendAcknowledge, setExtendAcknowledge] = useState(false);
  const [handoverTo, setHandoverTo] = useState('');
  // Workers / entry-log form state.
  const [workerName, setWorkerName] = useState('');
  const [workerRole, setWorkerRole] = useState<'supervisor' | 'worker' | 'entrant' | 'standby'>(
    'worker',
  );
  const [entryName, setEntryName] = useState('');
  const [closeChecks, setCloseChecks] = useState({
    workComplete: false,
    areaMadeSafe: false,
    isolationsRemoved: false,
    personnelClear: false,
  });
  const [closeNotes, setCloseNotes] = useState('');

  // Gas-reading form state. `gasLimitId` binds the reading to one of the
  // type's acceptable ranges — the unit follows the limit (PW-1).
  const [gasSubstance, setGasSubstance] = useState('');
  const [gasReading, setGasReading] = useState('');
  const [gasLimitId, setGasLimitId] = useState('');
  const [gasUnit, setGasUnit] = useState<'percent_lel' | 'percent_o2' | 'ppm' | 'mg_m3'>(
    'percent_lel',
  );

  const mutationOpts = {
    onSuccess: () => {
      setError(null);
      setPanel(null);
      setReason('');
      setConfirmResume(false);
      setExtendAcknowledge(false);
      void utils.permits.get.invalidate({ permitId });
      void utils.permits.overview.invalidate();
    },
    // BUG-05: this used to set the banner and nothing else. The banner
    // renders at the top of the page and the Issue button sits at the
    // bottom, so on a real permit the refusal was off-screen — Issue
    // appeared to do nothing at all, and a tester concluded the permit was
    // simply broken. Toast it as well, so the reason reaches the user
    // wherever they are on the page.
    onError: (err: { message: string }) => {
      setError(err.message);
      toast.error(permitErrorText(err.message) ?? tCommon('error'));
    },
  };

  const checkPrecondition = trpc.permits.checkPrecondition.useMutation({
    ...mutationOpts,
    // BUG-13: drop the optimistic intent once the server value is the one
    // being rendered. On a refusal it drops too, so the box snaps back to
    // the truth rather than lying about a tick that did not land. The
    // invalidate is awaited BEFORE the intent is dropped — clearing first
    // let the box briefly snap back to the stale pre-write value while the
    // refetch was still in flight.
    onSettled: async (_data, _err, vars) => {
      await utils.permits.get.invalidate({ permitId });
      setPendingChecks((prev) => {
        const next = { ...prev };
        delete next[vars.preconditionId];
        return next;
      });
    },
  });
  const recordGas = trpc.permits.recordGasReading.useMutation({
    ...mutationOpts,
    onSuccess: () => {
      mutationOpts.onSuccess();
      setGasSubstance('');
      setGasReading('');
    },
  });
  const authorise = trpc.permits.authorise.useMutation(mutationOpts);
  const issue = trpc.permits.issue.useMutation(mutationOpts);
  // PF-10: acceptance is signed at the entry point — often a dead spot.
  // Connectivity failure queues the accept; the flusher replays it.
  const accept = trpc.permits.accept.useMutation({
    ...mutationOpts,
    onError: (err) => {
      if (isNetworkError(err)) {
        enqueueOffline('permit-accept', { permitId });
        toast.success(tOffline('queuedToast'));
        return;
      }
      mutationOpts.onError(err);
    },
  });
  // BUG-05: an external acceptor countersigned on glass by the issuer.
  const acceptExternal = trpc.permits.acceptExternal.useMutation(mutationOpts);
  // PW-A1: the other half of the acceptor's decision. Without it the
  // only way to decline a permit was to cancel it, which kills the
  // record instead of returning it for correction.
  const refuse = trpc.permits.refuse.useMutation(mutationOpts);
  const suspend = trpc.permits.suspend.useMutation(mutationOpts);
  const resume = trpc.permits.resume.useMutation(mutationOpts);
  const extend = trpc.permits.extend.useMutation(mutationOpts);
  const handover = trpc.permits.handover.useMutation(mutationOpts);
  const close = trpc.permits.close.useMutation(mutationOpts);
  const cancel = trpc.permits.cancel.useMutation(mutationOpts);
  const updatePermit = trpc.permits.update.useMutation(mutationOpts);
  const setWorkers = trpc.permits.setWorkers.useMutation({
    ...mutationOpts,
    onSuccess: () => {
      mutationOpts.onSuccess();
      setWorkerName('');
    },
  });
  const logEntry = trpc.permits.logEntry.useMutation({
    ...mutationOpts,
    onSuccess: () => {
      mutationOpts.onSuccess();
      setEntryName('');
    },
  });
  const logExit = trpc.permits.logExit.useMutation(mutationOpts);

  // SIMOPs precheck for the extension's ADDED window (PW-4).
  const extendConflictsInput =
    permit !== undefined && newValidTo !== ''
      ? {
          ...(permit.siteId !== null ? { siteId: permit.siteId } : {}),
          validFrom: new Date(permit.validTo),
          validTo: new Date(newValidTo),
          locationText: permit.locationText,
          excludePermitId: permitId,
        }
      : null;
  const { data: extendConflicts } = trpc.permits.checkConflicts.useQuery(
    extendConflictsInput ?? { validFrom: new Date(0), validTo: new Date(0) },
    { enabled: extendConflictsInput !== null && panel === 'extend' },
  );

  if (isLoading || permit === undefined) {
    if (loadError !== null) return <DetailNotFound error={loadError} />;
    return (
      <div className="mx-auto w-full max-w-[900px] space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const isDraft = permit.status === 'draft';
  const isOpen =
    permit.status === 'issued' || permit.status === 'active' || permit.status === 'suspended';
  const isTerminal = permit.status === 'closed' || permit.status === 'cancelled';
  const isAcceptor =
    permit.acceptorUserId !== null && permit.acceptorUserId === permit.viewerUserId;
  // Competent persons (create), issuer authorities and the named acceptor
  // may record checks and evidence (PW-9) — the server enforces the same.
  const canRecord = canIssue || canCreate || isAcceptor;
  const allChecked = permit.preconditions.every((p) => p.checked);
  const gasLimits = permit.type.gasLimits;
  const requiresGas = permit.type.requiresGasTesting;
  // NR3-08: the substance default is DERIVED from the selected limit on
  // every render — not written once by the select's change handler, which
  // is what made the requirement look inconsistent after the post-record
  // reset. NR-03: the same draft carries the physical-bounds verdict.
  const selectedGasLimit = gasLimits.find((l) => l.id === gasLimitId);
  const gasDraft = resolveGasReadingDraft({
    typedSubstance: gasSubstance,
    selectedLimitLabel: selectedGasLimit?.label ?? null,
    reading: gasReading,
    unit: gasUnit,
  });
  const gasBounds = GAS_READING_BOUNDS[gasUnit];

  const fmt = (d: Date | string | null): string =>
    d === null
      ? '—'
      : new Date(d).toLocaleString(locale, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

  const requiresEvidence =
    permit.type.requiresGasTesting ||
    permit.type.requiresIsolationCertificate ||
    permit.type.requiresRescuePlan;

  const signatureRow = (
    label: string,
    name: string | null,
    at: Date | null,
    action?: ReactNode,
  ) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {at !== null ? (
          <p className="text-sm">
            <span className="font-medium">{name ?? '—'}</span>
            <span className="ml-2 text-xs text-muted-foreground">{fmt(at)}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{name ?? t('signatures.pending')}</p>
        )}
      </div>
      {action}
    </div>
  );

  const panelButton = (key: Exclude<PanelKey, null>, label: string, variant?: 'destructive') => (
    <Button
      variant={variant ?? 'outline'}
      size="sm"
      onClick={() => {
        setPanel(panel === key ? null : key);
        setError(null);
      }}
    >
      {label}
    </Button>
  );

  return (
    <div className="mx-auto w-full max-w-[900px] space-y-4 sm:space-y-6">
      <header className="space-y-2">
        <Link
          href={`/${locale}/permits`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {t('back')}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{permit.referenceNumber}</p>
            <h1 className="text-2xl font-semibold tracking-tight">{permit.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <PermitStatusChip status={permit.status} />
              <CategoryChip category={permit.type.category} name={permit.type.name} />
              {isOpen ? <CountdownChip validTo={permit.validTo} overdue={permit.overdue} /> : null}
            </div>
          </div>
          {/* The postable copy for the job face (PW-6). */}
          <Button asChild variant="outline" size="sm">
            <a
              href={`/api/exports/permit-pdf?permitId=${permitId}`}
              target="_blank"
              rel="noreferrer"
            >
              <FileDown className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('downloadPdf')}
            </a>
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t('fields.site')}</dt>
            <dd>{permit.siteName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t('fields.location')}</dt>
            <dd>{permit.locationText !== '' ? permit.locationText : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t('fields.validFrom')}</dt>
            <dd>{fmt(permit.validFrom)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t('fields.validTo')}</dt>
            <dd>
              {fmt(permit.validTo)}
              {permit.extensionCount > 0 ? (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {t('extensions', { count: permit.extensionCount })}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
        {permit.workDescription !== '' ? (
          <p className="text-sm text-muted-foreground">{permit.workDescription}</p>
        ) : null}
      </header>

      {/* Suspension banner */}
      {permit.status === 'suspended' ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">
            {t('suspendedBanner', { by: permit.parties.suspendedByName ?? '—' })}
          </p>
          {permit.suspensionReason !== '' ? (
            <p className="mt-1">{permit.suspensionReason}</p>
          ) : null}
        </div>
      ) : null}

      {/* Overdue banner */}
      {permit.overdue ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
          <p className="font-medium">{t('overdueBanner')}</p>
        </div>
      ) : null}

      {/* SIMOPs conflicts */}
      {permit.conflicts.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-medium">{t('conflicts.title', { count: permit.conflicts.length })}</p>
          <ul className="mt-1.5 space-y-1 text-xs">
            {permit.conflicts.map((c) => (
              <li key={c.permitId}>
                <Link href={`/${locale}/permits/${c.permitId}`} className="hover:underline">
                  {c.referenceNumber} · {c.title} ({c.typeName})
                </Link>
                {c.sameArea ? (
                  <span className="ml-1 font-semibold">{t('conflicts.sameArea')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <PermitErrorText message={error} />

      {/* Safe system of work — the RA and method statement this permit
          works under (PW-7). */}
      {(isDraft ||
        permit.riskAssessment !== null ||
        permit.methodStatement !== null ||
        permit.type.requiresRiskAssessment) && (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <h2 className="font-semibold">
              {t('ssow.title')}
              {permit.type.requiresRiskAssessment ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {t('ssow.requiredBeforeIssue')}
                </span>
              ) : null}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="text-sm">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('ssow.riskAssessment')}
                </p>
                {isDraft && canCreate ? (
                  <SearchSelect
                    className="mt-1"
                    value={permit.riskAssessmentId}
                    onChange={(next) => updatePermit.mutate({ permitId, riskAssessmentId: next })}
                    placeholder={t('ssow.none')}
                    options={(riskAssessmentOptions ?? []).map((ra) => ({
                      id: ra.id,
                      label: ra.title,
                      sub: ra.referenceNumber,
                    }))}
                  />
                ) : permit.riskAssessment !== null ? (
                  <Link
                    href={`/${locale}/risk-assessments/${permit.riskAssessment.id}`}
                    className="mt-1 inline-block text-primary hover:underline"
                  >
                    {permit.riskAssessment.referenceNumber !== null
                      ? `${permit.riskAssessment.referenceNumber} · `
                      : ''}
                    {permit.riskAssessment.title}
                  </Link>
                ) : (
                  <p className="mt-1 text-muted-foreground">{t('ssow.none')}</p>
                )}
              </div>
              <div className="text-sm">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('ssow.methodStatement')}
                </p>
                {isDraft && canCreate ? (
                  <SearchSelect
                    className="mt-1"
                    value={permit.methodStatementDocumentId}
                    onChange={(next) =>
                      updatePermit.mutate({ permitId, methodStatementDocumentId: next })
                    }
                    placeholder={t('ssow.none')}
                    options={(documentOptions?.documents ?? []).map((doc) => ({
                      id: doc.id,
                      label: doc.name,
                    }))}
                  />
                ) : permit.methodStatement !== null ? (
                  <Link
                    href={`/${locale}/documents`}
                    className="mt-1 inline-block text-primary hover:underline"
                  >
                    {permit.methodStatement.name}
                  </Link>
                ) : (
                  <p className="mt-1 text-muted-foreground">{t('ssow.none')}</p>
                )}
              </div>
            </div>
            {/* RS-A11: the RAMS gate is previewed here rather than only
                failing at Issue, when the issuer is standing at the job. */}
            {/* TR-B1: the competence shortfall, named. The server has
                returned `trainingShortfalls` since the gate was wired and
                nothing rendered it, so the issuer saw nothing until Issue
                failed at the job face. Every shortfall is listed — who, and
                which ticket — because "blocked" is not actionable and
                "swap Dave off this permit" is. */}
            {permit.trainingShortfalls.length > 0 ? (
              <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950/40">
                <p className="font-medium">{t('competence.blockedTitle')}</p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {permit.trainingShortfalls.map((sf) => (
                    <li key={`${sf.personLabel}-${sf.requirementId}`}>
                      {sf.reason === 'training-expired'
                        ? t('competence.personExpired', {
                            person: sf.personLabel,
                            requirement: sf.requirementName,
                          })
                        : t('competence.personMissing', {
                            person: sf.personLabel,
                            requirement: sf.requirementName,
                          })}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/${locale}/training`}
                  className="mt-1 inline-block text-primary hover:underline"
                >
                  {t('competence.openModule')}
                </Link>
              </div>
            ) : null}

            {permit.type.requiresRamsPack ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
                <p className="font-medium">{t('ssow.ramsRequired')}</p>
                <p className="mt-1 text-muted-foreground">
                  {permit.ramsGate === null
                    ? t('ssow.ramsSatisfied')
                    : permit.ramsGate === 'rams-pack-required'
                      ? t('ssow.ramsMissing')
                      : permit.ramsGate === 'rams-pack-not-issued'
                        ? t('ssow.ramsNotIssued')
                        : t('ssow.ramsExpired')}
                </p>
                {permit.ramsGate !== null ? (
                  <Link
                    href={`/${locale}/rams`}
                    className="mt-1 inline-block text-primary hover:underline"
                  >
                    {t('ssow.ramsOpenModule')}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* Preconditions */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold">{t('preconditions.title')}</h2>
            <span className="text-xs text-muted-foreground">
              {t('preconditions.progress', {
                done: permit.preconditions.filter((p) => p.checked).length,
                total: permit.preconditions.length,
              })}
            </span>
          </div>
          {permit.preconditions.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('preconditions.none')}</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {permit.preconditions.map((p) => (
                <li key={p.id} className="flex items-start gap-2.5">
                  {isDraft && canRecord ? (
                    <Checkbox
                      id={`precondition-${p.id}`}
                      checked={pendingChecks[p.id] ?? p.checked}
                      onCheckedChange={(v) => {
                        const next = v === true;
                        setPendingChecks((prev) => ({ ...prev, [p.id]: next }));
                        checkPrecondition.mutate({
                          permitId,
                          preconditionId: p.id,
                          checked: next,
                        });
                      }}
                      className="mt-0.5"
                    />
                  ) : (
                    <span
                      className={
                        p.checked
                          ? 'mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-sm bg-emerald-600 text-white'
                          : 'mt-0.5 inline-block h-4 w-4 rounded-sm border border-input'
                      }
                      aria-hidden="true"
                    >
                      {p.checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                  )}
                  <label
                    htmlFor={isDraft && canRecord ? `precondition-${p.id}` : undefined}
                    className="min-w-0 text-sm"
                  >
                    {p.label}
                    {p.checked && p.checkedByName !== null ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t('preconditions.checkedBy', {
                          name: p.checkedByName,
                          time: p.checkedAt !== null ? fmt(p.checkedAt) : '',
                        })}
                      </span>
                    ) : null}
                    {p.note !== '' ? (
                      <span className="block text-xs text-muted-foreground">{p.note}</span>
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Evidence: gas tests, isolation certificate, rescue plan, attachments */}
      {requiresEvidence || permit.gasReadings.length > 0 || permit.attachments.length > 0 ? (
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-6">
            <h2 className="font-semibold">{t('evidence.title')}</h2>

            {(permit.type.requiresGasTesting || permit.gasReadings.length > 0) && (
              <div>
                <h3 className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <Wind className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t('evidence.gasReadings')}
                  {permit.type.requiresGasTesting ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t('evidence.requiredBeforeIssue')}
                    </span>
                  ) : null}
                </h3>
                {gasLimits.length > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('evidence.acceptableRanges')}{' '}
                    {gasLimits.map((l) => `${l.label} ${limitRangeLabel(l)}`).join(' · ')}
                    {' — '}
                    {t('evidence.freshness', { minutes: permit.type.gasTestMaxAgeMinutes })}
                  </p>
                ) : null}
                {permit.gasReadings.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {permit.gasReadings.map((g) => (
                      <li key={g.id} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{g.substance}</span>
                        <span>
                          {g.reading} {GAS_UNIT_LABELS[g.unit] ?? g.unit}
                        </span>
                        {g.withinLimits === true ? (
                          <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100">
                            {t('evidence.withinLimits')}
                          </span>
                        ) : g.withinLimits === false ? (
                          <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-200">
                            {t('evidence.outOfLimits')}
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground">
                          {g.takenByName} · {fmt(g.takenAt)}
                          {g.note !== '' ? ` · ${g.note}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">{t('evidence.noReadings')}</p>
                )}
                {(isDraft || isOpen) && canRecord ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {gasLimits.length > 0 ? (
                      <div className="flex flex-col gap-1 text-sm">
                        <label
                          htmlFor="gas-limit"
                          className="text-xs font-medium text-muted-foreground"
                        >
                          {t('evidence.measuredAgainst')}
                        </label>
                        <select
                          id="gas-limit"
                          value={gasLimitId}
                          onChange={(e) => {
                            setGasLimitId(e.target.value);
                            const limit = gasLimits.find((l) => l.id === e.target.value);
                            // The substance default is no longer written here —
                            // it is derived via resolveGasReadingDraft (NR3-08).
                            if (limit !== undefined) setGasUnit(limit.unit);
                          }}
                          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        >
                          <option value="">{t('evidence.freeReading')}</option>
                          {gasLimits.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.label} ({limitRangeLabel(l)})
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-1 text-sm">
                      <label
                        htmlFor="gas-substance"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t('evidence.substance')}
                      </label>
                      <Input
                        id="gas-substance"
                        value={gasSubstance}
                        onChange={(e) => setGasSubstance(e.target.value)}
                        // NR3-08: shows what will be recorded when the field
                        // is left blank with a limit selected.
                        placeholder={selectedGasLimit?.label ?? ''}
                        className="h-9 w-40"
                      />
                      {gasDraft.substance === '' ? (
                        <span className="text-xs text-muted-foreground">
                          {t('evidence.substanceHint')}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1 text-sm">
                      <label
                        htmlFor="gas-reading"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t('evidence.reading')}
                      </label>
                      <Input
                        id="gas-reading"
                        type="number"
                        step="any"
                        min={gasBounds.min}
                        max={gasBounds.max}
                        value={gasReading}
                        onChange={(e) => setGasReading(e.target.value)}
                        className="h-9 w-24"
                      />
                      {!gasDraft.valueInBounds ? (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          {t('evidence.readingBounds', {
                            min: gasBounds.min,
                            max: gasBounds.max,
                            unit: GAS_UNIT_LABELS[gasUnit] ?? gasUnit,
                          })}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-1 text-sm">
                      <label
                        htmlFor="gas-unit"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        {t('evidence.unit')}
                      </label>
                      <select
                        id="gas-unit"
                        value={gasUnit}
                        disabled={gasLimitId !== ''}
                        onChange={(e) => setGasUnit(e.target.value as typeof gasUnit)}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                      >
                        {Object.entries(GAS_UNIT_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!gasDraft.canRecord || recordGas.isPending}
                      onClick={() =>
                        recordGas.mutate({
                          permitId,
                          substance: gasDraft.substance,
                          reading: gasDraft.value,
                          unit: gasUnit,
                          ...(gasLimitId !== '' ? { limitId: gasLimitId } : {}),
                        })
                      }
                    >
                      {t('evidence.recordReading')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}

            {(permit.type.requiresIsolationCertificate ||
              permit.isolationCertificateRef !== '') && (
              <div>
                <h3 className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t('evidence.isolationCertificate')}
                  {permit.type.requiresIsolationCertificate ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t('evidence.requiredBeforeIssue')}
                    </span>
                  ) : null}
                </h3>
                <p className="mt-1 text-sm">
                  {permit.isolationCertificateRef !== '' ? (
                    permit.isolationCertificateRef
                  ) : (
                    <span className="text-muted-foreground">{t('evidence.notRecorded')}</span>
                  )}
                </p>
                {isDraft && canCreate ? (
                  <IsolationRefEditor
                    permitId={permitId}
                    current={permit.isolationCertificateRef}
                    onSaved={() => void utils.permits.get.invalidate({ permitId })}
                  />
                ) : null}
              </div>
            )}

            {(permit.type.requiresRescuePlan || permit.rescuePlan !== '') && (
              <div>
                <h3 className="text-sm font-medium">
                  {t('evidence.rescuePlan')}
                  {permit.type.requiresRescuePlan ? (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {t('evidence.requiredBeforeIssue')}
                    </span>
                  ) : null}
                </h3>
                {permit.rescuePlan !== '' ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm">{permit.rescuePlan}</p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">{t('evidence.notRecorded')}</p>
                )}
                {isDraft && canCreate ? (
                  <RescuePlanEditor
                    permitId={permitId}
                    current={permit.rescuePlan}
                    onSaved={() => void utils.permits.get.invalidate({ permitId })}
                  />
                ) : null}
              </div>
            )}

            {permit.attachments.length > 0 ? (
              <div>
                <h3 className="inline-flex items-center gap-1.5 text-sm font-medium">
                  <Paperclip className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t('evidence.attachments')}
                </h3>
                <ul className="mt-1 space-y-1 text-sm">
                  {permit.attachments.map((a) => (
                    <li key={a.id}>
                      {a.filename}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t(`evidence.kinds.${a.kind}` as never)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* The gang + who is inside right now (PW-8). */}
      {(canRecord && (isDraft || isOpen)) ||
      permit.workers.length > 0 ||
      permit.entryLog.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="inline-flex items-center gap-1.5 font-semibold">
                <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t('workers.title')}
              </h2>
              {permit.insideCount > 0 ? (
                <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-200">
                  {t('workers.insideCount', { count: permit.insideCount })}
                </span>
              ) : null}
            </div>

            {permit.workers.length > 0 ? (
              <ul className="space-y-1.5">
                {permit.workers.map((w) => {
                  const openEntry = permit.entryLog.find(
                    (r) => r.exitedAt === null && (r.userId === w.userId || r.name === w.name),
                  );
                  return (
                    <li key={w.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{w.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t(`workers.roles.${w.role}` as never)}
                      </span>
                      {openEntry !== undefined ? (
                        <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                          {t('workers.inSince', { time: fmt(openEntry.enteredAt) })}
                        </span>
                      ) : null}
                      {canRecord && permit.status === 'active' && openEntry === undefined ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={logEntry.isPending}
                          onClick={() => logEntry.mutate({ permitId, workerId: w.id })}
                        >
                          <LogIn className="mr-1 h-3 w-3" aria-hidden="true" />
                          {t('workers.logEntry')}
                        </Button>
                      ) : null}
                      {canRecord && isOpen && openEntry !== undefined ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={logExit.isPending}
                          onClick={() => logExit.mutate({ permitId, entryId: openEntry.id })}
                        >
                          <LogOut className="mr-1 h-3 w-3" aria-hidden="true" />
                          {t('workers.logExit')}
                        </Button>
                      ) : null}
                      {canRecord && (isDraft || isOpen) ? (
                        <button
                          type="button"
                          aria-label={t('workers.remove')}
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setWorkers.mutate({
                              permitId,
                              workers: permit.workers
                                .filter((x) => x.id !== w.id)
                                .map((x) => ({
                                  id: x.id,
                                  name: x.name,
                                  userId: x.userId,
                                  role: x.role,
                                })),
                            })
                          }
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('workers.empty')}</p>
            )}

            {canRecord && (isDraft || isOpen) ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1 text-sm">
                  <label
                    htmlFor="worker-name"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t('workers.nameLabel')}
                  </label>
                  <Input
                    id="worker-name"
                    value={workerName}
                    onChange={(e) => setWorkerName(e.target.value)}
                    placeholder={t('workers.namePlaceholder')}
                    className="h-9 w-52"
                  />
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <label
                    htmlFor="worker-role"
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t('workers.roleLabel')}
                  </label>
                  <select
                    id="worker-role"
                    value={workerRole}
                    onChange={(e) => setWorkerRole(e.target.value as typeof workerRole)}
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    {(['supervisor', 'worker', 'entrant', 'standby'] as const).map((role) => (
                      <option key={role} value={role}>
                        {t(`workers.roles.${role}` as never)}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={workerName.trim() === '' || setWorkers.isPending}
                  onClick={() =>
                    setWorkers.mutate({
                      permitId,
                      workers: [
                        ...permit.workers.map((x) => ({
                          id: x.id,
                          name: x.name,
                          userId: x.userId,
                          role: x.role,
                        })),
                        { name: workerName.trim(), role: workerRole },
                      ],
                    })
                  }
                >
                  {t('workers.add')}
                </Button>
              </div>
            ) : null}

            {/* Ad-hoc entry (someone not on the list) + the full log. */}
            {canRecord && permit.status === 'active' ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1 text-sm">
                  <label htmlFor="entry-name" className="text-xs font-medium text-muted-foreground">
                    {t('workers.adhocEntryLabel')}
                  </label>
                  <Input
                    id="entry-name"
                    value={entryName}
                    onChange={(e) => setEntryName(e.target.value)}
                    placeholder={t('workers.namePlaceholder')}
                    className="h-9 w-52"
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={entryName.trim() === '' || logEntry.isPending}
                  onClick={() => logEntry.mutate({ permitId, name: entryName.trim() })}
                >
                  <LogIn className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  {t('workers.logEntry')}
                </Button>
              </div>
            ) : null}

            {permit.entryLog.length > 0 ? (
              <div>
                <p className="text-sm font-medium">{t('workers.logTitle')}</p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {permit.entryLog.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{row.name}</span>
                      <span>
                        {t('workers.entered', { time: fmt(row.enteredAt) })}
                        {row.exitedAt !== null
                          ? ` · ${t('workers.exited', { time: fmt(row.exitedAt) })}`
                          : ''}
                      </span>
                      {row.exitedAt === null ? (
                        <span className="rounded-md bg-red-100 px-1.5 py-0.5 font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-200">
                          {t('workers.stillIn')}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Signatures */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <h2 className="font-semibold">{t('signatures.title')}</h2>
          <div className="mt-2 divide-y">
            {permit.type.requiresAuthoriser
              ? signatureRow(
                  t('signatures.authoriser'),
                  permit.parties.authoriserName,
                  permit.authorisedAt,
                  isDraft && canIssue && permit.authorisedAt === null ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={authorise.isPending}
                      onClick={() => authorise.mutate({ permitId })}
                    >
                      {t('signatures.authoriseAction')}
                    </Button>
                  ) : undefined,
                )
              : null}
            {signatureRow(
              t('signatures.issuer'),
              permit.parties.issuerName,
              permit.issuedAt,
              isDraft && canIssue ? (
                <div className="flex flex-col items-end gap-1.5">
                  {permit.conflicts.length > 0 ? (
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Checkbox
                        checked={acknowledgeConflicts}
                        onCheckedChange={(v) => setAcknowledgeConflicts(v === true)}
                      />
                      {t('signatures.acknowledgeConflicts')}
                    </label>
                  ) : null}
                  {permit.ramsGate !== null ? (
                    <p className="max-w-xs text-right text-xs text-amber-700 dark:text-amber-400">
                      {t('signatures.ramsBlocked')}
                    </p>
                  ) : null}
                  {permit.trainingShortfalls.length > 0 ? (
                    <p className="max-w-xs text-right text-xs text-red-700 dark:text-red-400">
                      {t('signatures.competenceBlocked')}
                    </p>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={
                      issue.isPending ||
                      !allChecked ||
                      permit.ramsGate !== null ||
                      // The same verdict the server reaches, so the button is
                      // dead before it is pressed rather than after.
                      permit.trainingShortfalls.length > 0 ||
                      (permit.conflicts.length > 0 && !acknowledgeConflicts)
                    }
                    onClick={() => issue.mutate({ permitId, acknowledgeConflicts })}
                  >
                    {t('signatures.issueAction')}
                  </Button>
                </div>
              ) : undefined,
            )}
            {signatureRow(
              t('signatures.acceptor'),
              permit.parties.acceptorName,
              permit.acceptedAt,
              permit.status === 'issued' && permit.parties.acceptorIsExternal && canIssue ? (
                // BUG-05: an external acceptor has no seat, so they cannot
                // sign in and press this themselves. They are standing at
                // the issuing point — they type their name and the issuer
                // countersigns, which is what the paper permit does.
                <Button
                  size="sm"
                  disabled={acceptExternal.isPending}
                  onClick={() => {
                    const signed = window.prompt(
                      t('signatures.externalSignPrompt', {
                        name: permit.parties.acceptorName ?? '',
                      }),
                    );
                    if (signed === null || signed.trim().length < 2) return;
                    acceptExternal.mutate({ permitId, signedName: signed.trim() });
                  }}
                >
                  {t('signatures.acceptExternalAction')}
                </Button>
              ) : permit.status === 'issued' && isAcceptor ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={accept.isPending}
                    onClick={() => {
                      // Accepting a permit is a legal authorisation —
                      // welding beside a sprinkler head went through on
                      // one unconfirmed click, while the inspection
                      // module asks you to confirm a checklist. Ask on
                      // the one that matters.
                      if (!window.confirm(t('signatures.acceptConfirm'))) return;
                      accept.mutate({ permitId });
                    }}
                  >
                    {t('signatures.acceptAction')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={refuse.isPending}
                    onClick={() => {
                      const reason = window.prompt(t('signatures.refusePrompt'));
                      if (reason === null || reason.trim().length < 3) return;
                      refuse.mutate({ permitId, reason: reason.trim() });
                    }}
                  >
                    {t('signatures.refuseAction')}
                  </Button>
                </div>
              ) : undefined,
            )}
          </div>
          {/* BUG-05: a draft saved without an acceptor was un-fixable —
              Issue refused with "name an acceptor" and there was no field
              anywhere on the permit to name one. The only recovery was to
              cancel and re-raise. It is editable here for exactly as long
              as it is a draft. */}
          {isDraft && canCreate ? (
            <div className="mt-3 space-y-2 rounded-md border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t('signatures.setAcceptor')}
              </p>
              <SearchSelect
                value={permit.acceptorUserId}
                onChange={(next) =>
                  updatePermit.mutate({
                    permitId,
                    acceptorUserId: next,
                    // One or the other, never both.
                    ...(next !== null ? { acceptorName: '', acceptorOrganisation: '' } : {}),
                  })
                }
                placeholder={t('signatures.acceptorInternalPlaceholder')}
                options={(acceptorOptions?.users ?? []).map((u) => ({
                  id: u.id,
                  label: u.name ?? u.email,
                  sub: u.email,
                }))}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  defaultValue={permit.acceptorName}
                  placeholder={t('signatures.acceptorExternalPlaceholder')}
                  aria-label={t('signatures.acceptorExternalPlaceholder')}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value === permit.acceptorName) return;
                    updatePermit.mutate({
                      permitId,
                      acceptorName: value,
                      ...(value !== '' ? { acceptorUserId: null } : {}),
                    });
                  }}
                />
                <Input
                  defaultValue={permit.acceptorOrganisation}
                  placeholder={t('signatures.acceptorOrganisationPlaceholder')}
                  aria-label={t('signatures.acceptorOrganisationPlaceholder')}
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value === permit.acceptorOrganisation) return;
                    updatePermit.mutate({ permitId, acceptorOrganisation: value });
                  }}
                />
              </div>
            </div>
          ) : null}
          {permit.parties.acceptorIsExternal ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t('signatures.externalAcceptorNote', {
                organisation: permit.parties.acceptorOrganisation ?? '—',
              })}
            </p>
          ) : null}
          {permit.status === 'issued' && !isAcceptor && !permit.parties.acceptorIsExternal ? (
            <p className="mt-2 text-xs text-muted-foreground">{t('signatures.awaitingAcceptor')}</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Lifecycle actions */}
      {!isTerminal ? (
        <Card>
          <CardContent className="space-y-3 p-4 sm:p-6">
            <h2 className="font-semibold">{t('actions.title')}</h2>
            <div className="flex flex-wrap gap-2">
              {permit.status === 'active' && canIssue
                ? panelButton('suspend', t('actions.suspend'))
                : null}
              {permit.status === 'suspended' && canIssue
                ? panelButton('resume', t('actions.resume'))
                : null}
              {(permit.status === 'active' || permit.status === 'issued') && canIssue
                ? panelButton('extend', t('actions.extend'))
                : null}
              {(permit.status === 'active' || permit.status === 'issued') &&
              (canIssue || isAcceptor)
                ? panelButton('handover', t('actions.handover'))
                : null}
              {isOpen && canIssue ? panelButton('close', t('actions.close')) : null}
              {panelButton('cancel', t('actions.cancel'), 'destructive')}
            </div>

            {panel === 'suspend' ? (
              <div className="space-y-2 rounded-md border p-3">
                <label htmlFor="suspend-reason" className="text-sm font-medium">
                  {t('actions.suspendReason')}
                </label>
                <Textarea
                  id="suspend-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                />
                <Button
                  size="sm"
                  disabled={reason.trim().length < 3 || suspend.isPending}
                  onClick={() => suspend.mutate({ permitId, reason: reason.trim() })}
                >
                  {t('actions.suspendConfirm')}
                </Button>
              </div>
            ) : null}

            {/* Resume is a REAL confirmation (PW-3): restate why the permit
                was suspended, require the attestation, and remind gas
                types that a fresh in-range test is needed. */}
            {panel === 'resume' ? (
              <div className="space-y-2.5 rounded-md border p-3">
                <p className="text-sm font-medium">{t('actions.resumeTitle')}</p>
                {permit.suspensionReason !== '' ? (
                  <p className="text-sm text-muted-foreground">
                    {t('actions.resumeReasonRecap', { reason: permit.suspensionReason })}
                  </p>
                ) : null}
                {requiresGas ? (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {t('actions.resumeGasNote')}
                  </p>
                ) : null}
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={confirmResume}
                    onCheckedChange={(v) => setConfirmResume(v === true)}
                    className="mt-0.5"
                  />
                  {t('actions.resumeAttestation')}
                </label>
                <Button
                  size="sm"
                  disabled={!confirmResume || resume.isPending}
                  onClick={() => resume.mutate({ permitId, confirmSafeToResume: confirmResume })}
                >
                  {t('actions.resumeConfirm')}
                </Button>
              </div>
            ) : null}

            {panel === 'extend' ? (
              <div className="space-y-2 rounded-md border p-3">
                <label htmlFor="extend-to" className="text-sm font-medium">
                  {t('actions.extendTo')}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t('actions.extendHint', { hours: permit.type.maxDurationHours })}
                  {permit.type.requiresAuthoriser ? ` ${t('actions.extendReauthorisation')}` : ''}
                </p>
                <Input
                  id="extend-to"
                  type="datetime-local"
                  value={
                    newValidTo !== '' ? newValidTo : toLocalInputValue(new Date(permit.validTo))
                  }
                  onChange={(e) => setNewValidTo(e.target.value)}
                  className="w-60"
                />
                {/* SIMOPs over the ADDED window (PW-4): show and require
                    acknowledgement before the extension proceeds. */}
                {(extendConflicts ?? []).length > 0 ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                    <p className="font-medium">
                      {t('actions.extendConflicts', { count: (extendConflicts ?? []).length })}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {(extendConflicts ?? []).map((c) => (
                        <li key={c.permitId}>
                          {c.referenceNumber} · {c.title}
                          {c.sameArea ? ` — ${t('conflicts.sameArea')}` : ''}
                        </li>
                      ))}
                    </ul>
                    <label className="mt-1.5 flex items-center gap-1.5">
                      <Checkbox
                        checked={extendAcknowledge}
                        onCheckedChange={(v) => setExtendAcknowledge(v === true)}
                      />
                      {t('signatures.acknowledgeConflicts')}
                    </label>
                  </div>
                ) : null}
                <Button
                  size="sm"
                  disabled={
                    newValidTo === '' ||
                    extend.isPending ||
                    ((extendConflicts ?? []).length > 0 && !extendAcknowledge)
                  }
                  onClick={() =>
                    extend.mutate({
                      permitId,
                      newValidTo: new Date(newValidTo),
                      acknowledgeConflicts: extendAcknowledge,
                    })
                  }
                >
                  {t('actions.extendConfirm')}
                </Button>
              </div>
            ) : null}

            {panel === 'handover' ? (
              <div className="space-y-2 rounded-md border p-3">
                <label htmlFor="handover-to" className="text-sm font-medium">
                  {t('actions.handoverTo')}
                </label>
                <p className="text-xs text-muted-foreground">{t('actions.handoverHint')}</p>
                {/* Searchable user picker; separation of duties (PW-5):
                    never the issuer, the current acceptor, or the
                    authorising engineer. */}
                <GroupUserSelector
                  mode="users"
                  multiple={false}
                  className="max-w-xs"
                  value={handoverTo !== '' ? [handoverTo] : []}
                  onChange={(next) => setHandoverTo(next[0] ?? '')}
                  filterUser={(u) =>
                    u.id !== permit.acceptorUserId &&
                    u.id !== permit.issuerUserId &&
                    u.id !== permit.authoriserUserId
                  }
                />
                <Button
                  size="sm"
                  disabled={handoverTo === '' || handover.isPending}
                  onClick={() => handover.mutate({ permitId, toUserId: handoverTo })}
                >
                  {t('actions.handoverConfirm')}
                </Button>
              </div>
            ) : null}

            {panel === 'close' ? (
              <div className="space-y-2.5 rounded-md border p-3">
                <p className="text-sm font-medium">{t('actions.closeChecksTitle')}</p>
                {(
                  ['workComplete', 'areaMadeSafe', 'isolationsRemoved', 'personnelClear'] as const
                ).map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={closeChecks[key]}
                      onCheckedChange={(v) =>
                        setCloseChecks((prev) => ({ ...prev, [key]: v === true }))
                      }
                    />
                    {t(`actions.closeChecks.${key}` as never)}
                  </label>
                ))}
                <Textarea
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  rows={2}
                  placeholder={t('actions.closeNotesPlaceholder')}
                />
                <Button
                  size="sm"
                  disabled={!Object.values(closeChecks).every(Boolean) || close.isPending}
                  onClick={() => close.mutate({ permitId, checks: closeChecks, notes: closeNotes })}
                >
                  {t('actions.closeConfirm')}
                </Button>
              </div>
            ) : null}

            {panel === 'cancel' ? (
              <div className="space-y-2 rounded-md border border-red-200 p-3 dark:border-red-900">
                <label htmlFor="cancel-reason" className="text-sm font-medium">
                  {t('actions.cancelReason')}
                </label>
                <Textarea
                  id="cancel-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={reason.trim().length < 3 || cancel.isPending}
                  onClick={() => cancel.mutate({ permitId, reason: reason.trim() })}
                >
                  {t('actions.cancelConfirm')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-sm sm:p-6">
            {permit.status === 'closed' ? (
              <p>
                {t('closedLine', {
                  name: permit.parties.closedByName ?? '—',
                  time: fmt(permit.closedAt),
                })}
                {permit.closureNotes !== '' ? (
                  <span className="block text-muted-foreground">{permit.closureNotes}</span>
                ) : null}
              </p>
            ) : (
              <p>
                {t('cancelledLine', {
                  name: permit.parties.cancelledByName ?? '—',
                  time: fmt(permit.cancelledAt),
                })}
                {permit.cancellationReason !== '' ? (
                  <span className="block text-muted-foreground">{permit.cancellationReason}</span>
                ) : null}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <h2 className="font-semibold">{t('timeline.title')}</h2>
          <ul className="mt-3 space-y-2">
            {permit.events.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {fmt(e.createdAt)}
                </span>
                <span>
                  <span className="font-medium">{t(`timeline.kinds.${e.kind}` as never)}</span>
                  {e.actorName !== null ? (
                    <span className="text-muted-foreground"> · {e.actorName}</span>
                  ) : null}
                  {e.detail !== '' ? (
                    <span className="block text-xs text-muted-foreground">
                      {/* BUG-14: extension events bake UTC ISO stamps into
                          their detail — reformat them like every other
                          timestamp on the page. */}
                      {formatIsoDatesInText(e.detail, (iso) => fmt(iso))}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/** Inline editor for the isolation-certificate reference (draft only). */
function IsolationRefEditor({
  permitId,
  current,
  onSaved,
}: {
  permitId: string;
  current: string;
  onSaved: () => void;
}) {
  const t = useTranslations('permits.detail.evidence');
  const [value, setValue] = useState(current);
  const update = trpc.permits.update.useMutation({ onSuccess: onSaved });
  return (
    <div className="mt-2 flex items-center gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('isolationRefPlaceholder')}
        className="h-9 w-64"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={value === current || update.isPending}
        onClick={() => update.mutate({ permitId, isolationCertificateRef: value })}
      >
        {t('save')}
      </Button>
    </div>
  );
}

/** Inline editor for the rescue plan text (draft only). */
function RescuePlanEditor({
  permitId,
  current,
  onSaved,
}: {
  permitId: string;
  current: string;
  onSaved: () => void;
}) {
  const t = useTranslations('permits.detail.evidence');
  const [value, setValue] = useState(current);
  const update = trpc.permits.update.useMutation({ onSuccess: onSaved });
  return (
    <div className="mt-2 space-y-2">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder={t('rescuePlanPlaceholder')}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={value === current || update.isPending}
        onClick={() => update.mutate({ permitId, rescuePlan: value })}
      >
        {t('save')}
      </Button>
    </div>
  );
}
