'use client';

/**
 * The incident page — top-to-bottom like a worked file (the permit-page
 * pattern): header + chips, statutory banners, triage, people & lost
 * time, the RIDDOR panel, investigation summary (workspace linked),
 * findings & live actions, linked records + the prompt-reviews step,
 * effectiveness, lifecycle actions and the append-only timeline.
 * Everything the auditor follows from event → determination →
 * investigation → actions → effectiveness on one screen (S4).
 */
import { ChevronLeft, ExternalLink, FileDown, Microscope, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import {
  INCIDENT_SEVERITIES,
  INVESTIGATION_LEVELS,
  RIDDOR_CATEGORIES,
  isRiddorReportable,
} from '@forma360/shared/incidents';
import {
  ConfidentialChip,
  IncidentStatusChip,
  KindChip,
  LateReportChip,
  RiddorChip,
  SeverityChip,
} from '../../../../src/components/incidents/chips';
import { IncidentErrorText } from '../../../../src/components/incidents/incident-error';
import { DetailNotFound } from '../../../../src/components/detail-not-found';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';
import { formatDate, formatDateTime } from '../../../../src/lib/format-date';

function fmt(value: string | Date | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return formatDateTime(d, locale);
}

function fmtDate(value: string | Date | null | undefined, locale: string): string {
  if (value === null || value === undefined) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return formatDate(d, locale);
}

export default function IncidentDetailPage() {
  const t = useTranslations('incidents');
  const params = useParams<{ locale: string; incidentId: string }>();
  const locale = params.locale ?? 'en';
  const incidentId = params.incidentId ?? '';
  const router = useRouter();
  const utils = trpc.useUtils();
  const canManage = useHasPermission('incidents.manage');
  const canInvestigate = useHasPermission('incidents.investigate');

  const { data, isLoading, error } = trpc.incidents.get.useQuery(
    { incidentId },
    { enabled: incidentId.length === 26 },
  );

  const [actionError, setActionError] = useState<unknown>(null);
  const [panel, setPanel] = useState<
    | 'none'
    | 'triage'
    | 'screen'
    | 'submitRiddor'
    | 'close'
    | 'reopen'
    | 'cancel'
    | 'effectiveness'
    | 'edit'
    | 'severity'
  >('none');

  const invalidate = async (): Promise<void> => {
    await utils.incidents.get.invalidate({ incidentId });
    await utils.incidents.list.invalidate();
    await utils.incidents.overview.invalidate();
  };

  const mutationOpts = {
    onSuccess: async () => {
      setActionError(null);
      setPanel('none');
      await invalidate();
    },
    onError: (err: unknown) => setActionError(err),
  };

  const triageMutation = trpc.incidents.triage.useMutation(mutationOpts);
  const screenMutation = trpc.incidents.riddorScreen.useMutation(mutationOpts);
  const submitRiddorMutation = trpc.incidents.riddorRecordSubmission.useMutation(mutationOpts);
  const startInvestigationMutation = trpc.incidents.startInvestigation.useMutation({
    onSuccess: async () => {
      setActionError(null);
      await invalidate();
      router.push(`/${locale}/incidents/${incidentId}/investigation`);
    },
    onError: (err: unknown) => setActionError(err),
  });
  const closeMutation = trpc.incidents.close.useMutation(mutationOpts);
  const reopenMutation = trpc.incidents.reopen.useMutation(mutationOpts);
  const cancelMutation = trpc.incidents.cancel.useMutation(mutationOpts);
  const effectivenessMutation = trpc.incidents.recordEffectiveness.useMutation(mutationOpts);
  const addPersonMutation = trpc.incidents.addPerson.useMutation(mutationOpts);
  const updatePersonMutation = trpc.incidents.updatePerson.useMutation(mutationOpts);
  const addAbsenceMutation = trpc.incidents.addAbsence.useMutation(mutationOpts);
  const updateAbsenceMutation = trpc.incidents.updateAbsence.useMutation(mutationOpts);
  const promptReviewsMutation = trpc.incidents.promptReviews.useMutation(mutationOpts);
  const skipReviewsMutation = trpc.incidents.skipReviews.useMutation(mutationOpts);
  // IN-A7: the correction surface — records must be correctable, with
  // every change on the event log.
  const updateMutation = trpc.incidents.update.useMutation(mutationOpts);
  const setSeverityMutation = trpc.incidents.setSeverity.useMutation(mutationOpts);
  const setLevelMutation = trpc.incidents.setInvestigationLevel.useMutation(mutationOpts);
  const assignInvestigatorMutation = trpc.incidents.assignInvestigator.useMutation(mutationOpts);
  const removePersonMutation = trpc.incidents.removePerson.useMutation(mutationOpts);
  const removeAbsenceMutation = trpc.incidents.removeAbsence.useMutation(mutationOpts);

  // Triage form state.
  const [triSeverity, setTriSeverity] = useState('moderate');
  const [triLevel, setTriLevel] = useState('basic');
  const [triLead, setTriLead] = useState<string[]>([]);
  const [triConfidential, setTriConfidential] = useState<boolean | null>(null);
  // RIDDOR screen form state.
  const [screenCategory, setScreenCategory] = useState('');
  const [screenNote, setScreenNote] = useState('');
  // Submission form state.
  const [subRoute, setSubRoute] = useState<'online' | 'phone'>('online');
  const [subRef, setSubRef] = useState('');
  // Lifecycle reasons.
  const [reason, setReason] = useState('');
  // Effectiveness.
  const [effVerdict, setEffVerdict] = useState('effective');
  const [effNote, setEffNote] = useState('');
  // Person add form.
  const [personName, setPersonName] = useState('');
  const [personCategory, setPersonCategory] = useState('employee');
  // Absence add form (per person id).
  const [absencePersonId, setAbsencePersonId] = useState('');
  const [absenceFrom, setAbsenceFrom] = useState('');
  const [absenceTo, setAbsenceTo] = useState('');
  // Prompt reviews.
  const [selectedRas, setSelectedRas] = useState<string[]>([]);
  const [selectedCoshh, setSelectedCoshh] = useState<string[]>([]);
  const [selectedFras, setSelectedFras] = useState<string[]>([]);
  const [skipReason, setSkipReason] = useState('');
  const [showSkip, setShowSkip] = useState(false);
  // IN-A7: edit-details dialog state.
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editOccurredAt, setEditOccurredAt] = useState('');
  const [editSiteId, setEditSiteId] = useState('');
  const [editLocation, setEditLocation] = useState('');
  // IN-A7: severity correction + lead reassignment.
  const [sevValue, setSevValue] = useState('');
  const [leadValue, setLeadValue] = useState<string[]>([]);
  const [showReassign, setShowReassign] = useState(false);
  // IN-A9: scene evidence upload from the incident page.
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const [evidenceUploading, setEvidenceUploading] = useState(false);
  const [evidenceUploadErrors, setEvidenceUploadErrors] = useState<string[]>([]);

  const { data: candidates } = trpc.incidents.reviewPromptCandidates.useQuery(undefined, {
    enabled: canManage && data !== undefined,
  });

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-3 p-4 md:p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
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

  // IN-A11: surface the event payload — the why behind a reopen /
  // cancellation / skip, who was assigned, what changed — instead of
  // label-only rows the auditor has to chase into the database.
  const describeEvent = (kind: string, rawDetail: unknown): string | null => {
    if (rawDetail === null || typeof rawDetail !== 'object') return null;
    // jsonb boundary: proven an object above; every value is shape-
    // checked before use.
    const detail = rawDetail as Record<string, unknown>;
    const str = (key: string): string | null => {
      const value = detail[key];
      return typeof value === 'string' && value !== '' ? value : null;
    };
    const num = (key: string): number | null => {
      const value = detail[key];
      return typeof value === 'number' ? value : null;
    };
    const parts: string[] = [];
    switch (kind) {
      case 'triaged': {
        const severity = str('severity');
        const level = str('level');
        if (severity !== null) parts.push(t(`severities.${severity}` as never));
        if (level !== null) parts.push(t(`triage.levels.${level}` as never));
        break;
      }
      case 'severity_changed': {
        const from = str('from');
        const to = str('to');
        if (from !== null && to !== null) {
          parts.push(`${t(`severities.${from}` as never)} → ${t(`severities.${to}` as never)}`);
        }
        break;
      }
      case 'investigation_level_changed': {
        const from = str('from');
        const to = str('to');
        if (from !== null && to !== null) {
          parts.push(
            `${t(`triage.levels.${from}` as never)} → ${t(`triage.levels.${to}` as never)}`,
          );
        }
        break;
      }
      case 'investigator_assigned': {
        const userId = str('userId');
        if (userId !== null) parts.push(nameOf(userId));
        break;
      }
      case 'riddor_screened': {
        const category = str('category');
        if (category !== null) parts.push(t(`riddor.categories.${category}` as never));
        break;
      }
      case 'riddor_submitted': {
        const route = str('route');
        if (route === 'online') parts.push(t('riddor.routeOnline'));
        if (route === 'phone') parts.push(t('riddor.routePhone'));
        const ref = str('hseReference');
        if (ref !== null) parts.push(ref);
        break;
      }
      case 'investigation_started':
      case 'investigation_submitted':
      case 'investigation_rejected':
      case 'investigation_approved': {
        const revision = num('revision');
        if (revision !== null) parts.push(t('timeline.revision', { revision }));
        if (detail.soleManagerOverride === true) parts.push(t('timeline.soleManagerOverride'));
        break;
      }
      case 'actions_generated': {
        const count = num('count');
        if (count !== null) parts.push(t('timeline.actionCount', { count }));
        break;
      }
      case 'alert_sent': {
        const notified = num('notified');
        if (notified !== null) parts.push(t('timeline.notifiedCount', { count: notified }));
        break;
      }
      case 'effectiveness_recorded': {
        const verdict = str('verdict');
        if (verdict !== null) parts.push(t(`effectiveness.verdicts.${verdict}` as never));
        break;
      }
      case 'witness_statement_added': {
        const witnessName = str('witnessName');
        if (witnessName !== null) parts.push(witnessName);
        break;
      }
      default:
        break;
    }
    // Free-text "why" fields, on whichever kind carries them.
    const reason = str('reason');
    if (reason !== null) parts.push(reason);
    const note = str('note');
    if (note !== null) parts.push(note);
    const justification = str('justification');
    if (justification !== null) parts.push(justification);
    return parts.length > 0 ? parts.join(' · ') : null;
  };
  const isTerminal = incident.status === 'closed' || incident.status === 'cancelled';
  const latestInvestigation =
    data.investigations.length > 0
      ? data.investigations[data.investigations.length - 1]
      : undefined;
  const riddorOverdue =
    incident.riddorCategory !== null &&
    incident.riddorCategory !== 'not_reportable' &&
    incident.riddorSubmittedAt === null &&
    incident.riddorDeadlineAt !== null &&
    new Date(incident.riddorDeadlineAt) <= new Date();
  const reviewStepOpen =
    (incident.status === 'actions_outstanding' || incident.status === 'closed') &&
    incident.reviewPromptAt === null &&
    incident.reviewPromptSkippedReason === null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 md:p-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/${locale}/incidents`}>
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span className="font-mono text-sm text-muted-foreground">
              {incident.referenceNumber}
            </span>
          </div>
          <h1 className="text-xl font-semibold">{incident.title}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <KindChip kind={incident.kind} />
            <SeverityChip severity={incident.severity} />
            {canManage && !isTerminal ? (
              <button
                type="button"
                onClick={() => {
                  setSevValue(incident.severity);
                  setPanel(panel === 'severity' ? 'none' : 'severity');
                }}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {t('detail.change')}
              </button>
            ) : null}
            <IncidentStatusChip status={incident.status} />
            <RiddorChip
              category={incident.riddorCategory}
              deadlineAt={incident.riddorDeadlineAt}
              submittedAt={incident.riddorSubmittedAt}
            />
            {data.lateReport ? <LateReportChip /> : null}
            {incident.confidential ? <ConfidentialChip /> : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(canManage ||
            (incident.reportedByUserId === data.viewerUserId && incident.status === 'reported')) &&
          !isTerminal ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditTitle(incident.title);
                setEditDescription(incident.description);
                const occurred = new Date(incident.occurredAt);
                occurred.setMinutes(occurred.getMinutes() - occurred.getTimezoneOffset());
                setEditOccurredAt(occurred.toISOString().slice(0, 16));
                setEditSiteId(incident.siteId ?? '');
                setEditLocation(incident.locationText);
                setPanel(panel === 'edit' ? 'none' : 'edit');
              }}
            >
              <Pencil className="mr-1.5 h-4 w-4" />
              {t('detail.edit')}
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm">
            <a href={`/api/exports/incident-pdf?incidentId=${incident.id}`} target="_blank">
              <FileDown className="mr-1.5 h-4 w-4" />
              {t('detail.downloadPdf')}
            </a>
          </Button>
        </div>
      </div>

      {/* ── IN-A7: severity correction ── */}
      {panel === 'severity' ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 p-4">
            <div className="space-y-1.5">
              <Label>{t('detail.severityHeading')}</Label>
              <select
                value={sevValue}
                onChange={(e) => setSevValue(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {INCIDENT_SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {t(`severities.${s}` as never)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={sevValue === incident.severity || setSeverityMutation.isPending}
              onClick={() =>
                setSeverityMutation.mutate({ incidentId, severity: sevValue as never })
              }
            >
              {t('common.save')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPanel('none')}>
              {t('common.cancel')}
            </Button>
            <p className="w-full text-xs text-muted-foreground">{t('detail.severityHint')}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* ── IN-A7: edit details ── */}
      {panel === 'edit' ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('detail.editHeading')}</h2>
            <div className="space-y-1.5">
              <Label>{t('new.whatHappened')}</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={300}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t('new.when')}</Label>
                <Input
                  type="datetime-local"
                  value={editOccurredAt}
                  onChange={(e) => setEditOccurredAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('new.location')}</Label>
                <Input
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  maxLength={500}
                />
              </div>
            </div>
            <SiteSelector
              value={editSiteId === '' ? [] : [editSiteId]}
              onChange={(next) => setEditSiteId(next[0] ?? '')}
              multiple={false}
              label={t('new.site')}
              placeholder={t('new.sitePlaceholder')}
            />
            <div className="space-y-1.5">
              <Label>{t('new.description')}</Label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={editTitle.trim() === '' || updateMutation.isPending}
                onClick={() =>
                  updateMutation.mutate({
                    incidentId,
                    title: editTitle.trim(),
                    description: editDescription,
                    occurredAt: new Date(editOccurredAt),
                    siteId: editSiteId === '' ? null : editSiteId,
                    locationText: editLocation,
                  })
                }
              >
                {t('common.save')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPanel('none')}>
                {t('common.cancel')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Banners ── */}
      {riddorOverdue ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {t('detail.riddorOverdueBanner')}
        </div>
      ) : null}
      {incident.riddorRescreenRequired ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {t('detail.rescreenBanner')}
        </div>
      ) : null}
      {incident.effectivenessVerdict === 'not_effective' && incident.status === 'closed' ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {t('detail.notEffectiveBanner')}
        </div>
      ) : null}

      {actionError !== null ? <IncidentErrorText error={actionError} /> : null}

      {/* ── Record ── */}
      <Card>
        <CardContent className="space-y-2 p-4 text-sm">
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">{t('detail.occurred')}: </span>
              {fmt(incident.occurredAt, locale)}
            </p>
            <p>
              <span className="text-muted-foreground">{t('detail.reported')}: </span>
              {fmt(incident.reportedAt, locale)} · {nameOf(incident.reportedByUserId)}
            </p>
            <p>
              <span className="text-muted-foreground">{t('detail.site')}: </span>
              {data.site?.name ?? '—'}
              {incident.locationText !== '' ? ` · ${incident.locationText}` : ''}
            </p>
            {incident.potentialSeverity !== null ? (
              <p>
                <span className="text-muted-foreground">{t('detail.potentialSeverity')}: </span>
                {t(`severities.${incident.potentialSeverity}` as never)}
              </p>
            ) : null}
          </div>
          {incident.description !== '' ? (
            <p className="whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">
              {incident.description}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Triage ── */}
      {canManage && incident.status === 'reported' ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t('triage.heading')}</h2>
              {panel !== 'triage' ? (
                <Button type="button" size="sm" onClick={() => setPanel('triage')}>
                  {t('triage.open')}
                </Button>
              ) : null}
            </div>
            {panel === 'triage' ? (
              <div className="space-y-3">
                {(() => {
                  // IN-A3: the level floor follows the severity pick (and
                  // any existing reportable screening) live in the dialog.
                  const floorFull =
                    triSeverity === 'serious' ||
                    triSeverity === 'major' ||
                    (incident.riddorCategory !== null &&
                      isRiddorReportable(incident.riddorCategory));
                  return (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>{t('triage.severity')}</Label>
                        <select
                          value={triSeverity}
                          onChange={(e) => {
                            setTriSeverity(e.target.value);
                            if (e.target.value === 'serious' || e.target.value === 'major') {
                              setTriLevel('full');
                            }
                          }}
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        >
                          {INCIDENT_SEVERITIES.map((s) => (
                            <option key={s} value={s}>
                              {t(`severities.${s}` as never)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t('triage.level')}</Label>
                        <select
                          value={floorFull ? 'full' : triLevel}
                          onChange={(e) => setTriLevel(e.target.value)}
                          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                        >
                          {INVESTIGATION_LEVELS.map((l) => (
                            <option key={l} value={l} disabled={floorFull && l === 'basic'}>
                              {t(`triage.levels.${l}` as never)}
                            </option>
                          ))}
                        </select>
                        {floorFull ? (
                          <p className="text-xs text-muted-foreground">
                            {t('triage.levelFloorHint')}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })()}
                <GroupUserSelector
                  value={triLead}
                  onChange={setTriLead}
                  mode="users"
                  multiple={false}
                  label={t('triage.leadInvestigator')}
                  placeholder={t('triage.leadPlaceholder')}
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={triConfidential ?? incident.confidential}
                    onChange={(e) => setTriConfidential(e.target.checked)}
                  />
                  {t('triage.confidential')}
                </label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={triLead[0] === undefined || triageMutation.isPending}
                    onClick={() =>
                      triageMutation.mutate({
                        incidentId,
                        severity: triSeverity as never,
                        // IN-A3: send the floored level, matching the UI.
                        investigationLevel: (triSeverity === 'serious' ||
                        triSeverity === 'major' ||
                        (incident.riddorCategory !== null &&
                          isRiddorReportable(incident.riddorCategory))
                          ? 'full'
                          : triLevel) as never,
                        leadInvestigatorUserId: triLead[0] ?? '',
                        ...(triConfidential !== null ? { confidential: triConfidential } : {}),
                      })
                    }
                  >
                    {t('triage.confirm')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPanel('none')}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('triage.hint')}</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* ── People & lost time ── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('people.heading')}</h2>
            <span className="text-sm text-muted-foreground">
              {t('people.daysLost', { days: data.daysLost })}
            </span>
          </div>
          {data.persons.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('people.none')}</p>
          ) : (
            <div className="space-y-2">
              {data.persons.map((person) => {
                const injury = person.injury as {
                  bodyParts?: string[];
                  injuryKinds?: string[];
                  firstAidGiven?: boolean;
                  hospitalisation?: string;
                };
                const personAbsences = data.absences.filter((a) => a.personId === person.id);
                return (
                  <div key={person.id} className="space-y-1.5 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {person.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t(`personCategories.${person.category}` as never)}
                        </span>
                      </p>
                      {!isTerminal && (canManage || canInvestigate) ? (
                        <div className="flex items-center gap-2">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5"
                              checked={person.returnedToWork}
                              onChange={(e) =>
                                updatePersonMutation.mutate({
                                  incidentId,
                                  personId: person.id,
                                  returnedToWork: e.target.checked,
                                })
                              }
                            />
                            {t('people.returnedToWork')}
                          </label>
                          {canManage ? (
                            /* IN-A7: personal-injury data added by mistake
                               must be removable; the event log keeps the
                               audit trail. */
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                if (window.confirm(t('people.removeConfirm'))) {
                                  removePersonMutation.mutate({
                                    incidentId,
                                    personId: person.id,
                                  });
                                }
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    {(injury.injuryKinds?.length ?? 0) > 0 ||
                    (injury.bodyParts?.length ?? 0) > 0 ? (
                      <p className="text-muted-foreground">
                        {(injury.injuryKinds ?? [])
                          .map((k) => t(`injuryKinds.${k}` as never))
                          .join(', ')}
                        {(injury.bodyParts?.length ?? 0) > 0
                          ? ` — ${(injury.bodyParts ?? []).map((p) => t(`bodyParts.${p}` as never)).join(', ')}`
                          : ''}
                        {injury.firstAidGiven === true ? ` · ${t('people.firstAid')}` : ''}
                        {injury.hospitalisation === 'ae'
                          ? ` · ${t('hospitalisations.ae')}`
                          : injury.hospitalisation === 'admitted'
                            ? ` · ${t('hospitalisations.admitted')}`
                            : ''}
                      </p>
                    ) : null}
                    {personAbsences.length > 0 ? (
                      <div className="space-y-1">
                        {personAbsences.map((absence) => (
                          <div
                            key={absence.id}
                            className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                          >
                            <span>
                              {t('people.absence')}: {fmtDate(absence.fromDate, locale)} →{' '}
                              {absence.toDate !== null
                                ? fmtDate(absence.toDate, locale)
                                : t('people.ongoing')}
                            </span>
                            <span className="flex items-center gap-1">
                              {absence.toDate === null &&
                              !isTerminal &&
                              (canManage || canInvestigate) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    updateAbsenceMutation.mutate({
                                      incidentId,
                                      absenceId: absence.id,
                                      toDate: new Date().toISOString().slice(0, 10),
                                    })
                                  }
                                >
                                  {t('people.endAbsence')}
                                </Button>
                              ) : null}
                              {!isTerminal && canManage ? (
                                /* IN-A7: a mistyped absence drives the
                                   RIDDOR re-screen — it must be removable. */
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    if (window.confirm(t('people.removeAbsenceConfirm'))) {
                                      removeAbsenceMutation.mutate({
                                        incidentId,
                                        absenceId: absence.id,
                                      });
                                    }
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              ) : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {!isTerminal && (canManage || canInvestigate) ? (
                      absencePersonId === person.id ? (
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">{t('people.absenceFrom')}</Label>
                            <Input
                              type="date"
                              value={absenceFrom}
                              onChange={(e) => setAbsenceFrom(e.target.value)}
                              className="h-8 w-36"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">{t('people.absenceTo')}</Label>
                            <Input
                              type="date"
                              value={absenceTo}
                              onChange={(e) => setAbsenceTo(e.target.value)}
                              className="h-8 w-36"
                            />
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            disabled={absenceFrom === '' || addAbsenceMutation.isPending}
                            onClick={() => {
                              addAbsenceMutation.mutate({
                                incidentId,
                                personId: person.id,
                                fromDate: absenceFrom,
                                toDate: absenceTo === '' ? null : absenceTo,
                              });
                              setAbsencePersonId('');
                              setAbsenceFrom('');
                              setAbsenceTo('');
                            }}
                          >
                            {t('common.save')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setAbsencePersonId('')}
                          >
                            {t('common.cancel')}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setAbsencePersonId(person.id)}
                        >
                          {t('people.addAbsence')}
                        </Button>
                      )
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
          {!isTerminal && (canManage || canInvestigate) ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder={t('new.personNamePlaceholder')}
                className="h-9 w-48"
              />
              <select
                value={personCategory}
                onChange={(e) => setPersonCategory(e.target.value)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                {(
                  [
                    'employee',
                    'contractor',
                    'agency',
                    'visitor',
                    'member_of_public',
                    'work_experience',
                  ] as const
                ).map((c) => (
                  <option key={c} value={c}>
                    {t(`personCategories.${c}` as never)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={personName.trim() === '' || addPersonMutation.isPending}
                onClick={() => {
                  addPersonMutation.mutate({
                    incidentId,
                    name: personName.trim(),
                    category: personCategory as never,
                    injury: {},
                    ohFollowUpRequired: false,
                  });
                  setPersonName('');
                }}
              >
                {t('people.addPerson')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── IN-A9: evidence & statements — visible from the moment they
             exist, not only once an investigation starts. OH needs the
             sharps photos immediately. ── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('evidence.heading')}</h2>
            {!isTerminal && (canManage || canInvestigate) ? (
              <div>
                <input
                  ref={evidenceInputRef}
                  type="file"
                  accept="image/*,video/mp4,video/quicktime,video/webm,application/pdf"
                  capture="environment"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files === null || files.length === 0) return;
                    void (async () => {
                      setEvidenceUploading(true);
                      const failed: string[] = [];
                      try {
                        for (const file of Array.from(files)) {
                          try {
                            const form = new FormData();
                            form.append('incidentId', incidentId);
                            form.append('file', file);
                            const res = await fetch('/api/upload/incident-evidence', {
                              method: 'POST',
                              body: form,
                            });
                            if (!res.ok) {
                              failed.push(file.name);
                              continue;
                            }
                            const body = (await res.json()) as {
                              storageKey: string;
                              filename: string;
                            };
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
                        setEvidenceUploading(false);
                        setEvidenceUploadErrors(failed);
                      }
                    })();
                    e.target.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={evidenceUploading}
                  onClick={() => evidenceInputRef.current?.click()}
                >
                  {evidenceUploading ? t('new.uploading') : t('evidence.addFiles')}
                </Button>
              </div>
            ) : null}
          </div>
          {evidenceUploadErrors.length > 0 ? (
            <p className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {t('new.uploadFailed', { files: evidenceUploadErrors.join(', ') })}
            </p>
          ) : null}
          {data.evidence.length === 0 && data.witnesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('evidence.none')}</p>
          ) : (
            <div className="space-y-1">
              {data.evidence.map((item) => (
                <div key={item.id} className="flex items-baseline gap-2 text-sm">
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(`evidenceKinds.${item.kind}` as never)}
                  </span>
                  <span>{item.filename ?? item.caption}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {nameOf(item.collectedByUserId)}
                  </span>
                </div>
              ))}
              {data.witnesses.map((witness) => (
                <div key={witness.id} className="flex items-baseline gap-2 text-sm">
                  <span className="rounded-full border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t('evidence.witness')}
                  </span>
                  <span>{witness.witnessName}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {nameOf(witness.takenByUserId)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── RIDDOR ── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('riddor.heading')}</h2>
            {canManage && !isTerminal && incident.riddorSubmittedAt === null ? (
              <Button
                type="button"
                size="sm"
                variant={incident.riddorCategory === null ? 'default' : 'outline'}
                onClick={() => {
                  setScreenCategory(incident.riddorCategory ?? '');
                  setScreenNote(incident.riddorDeterminationNote);
                  setPanel(panel === 'screen' ? 'none' : 'screen');
                }}
              >
                {incident.riddorCategory === null ? t('riddor.screen') : t('riddor.rescreen')}
              </Button>
            ) : null}
          </div>

          {incident.riddorCategory === null ? (
            <p className="text-sm text-muted-foreground">{t('riddor.notScreened')}</p>
          ) : (
            <div className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">{t('riddor.determination')}: </span>
                <span
                  className={
                    isRiddorReportable(incident.riddorCategory) ? 'font-semibold text-red-600' : ''
                  }
                >
                  {t(`riddor.categories.${incident.riddorCategory}` as never)}
                </span>
              </p>
              <p className="text-muted-foreground">
                {t('riddor.screenedBy', {
                  name: nameOf(incident.riddorScreenedByUserId),
                  date: fmt(incident.riddorScreenedAt, locale),
                })}
              </p>
              {incident.riddorDeterminationNote !== '' ? (
                <p className="whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">
                  {incident.riddorDeterminationNote}
                </p>
              ) : null}
              {incident.riddorDeadlineAt !== null && incident.riddorSubmittedAt === null ? (
                <p>
                  <span className="text-muted-foreground">{t('riddor.deadline')}: </span>
                  {fmt(incident.riddorDeadlineAt, locale)}
                </p>
              ) : null}
              {incident.riddorSubmittedAt !== null ? (
                <p>
                  <span className="text-muted-foreground">{t('riddor.submitted')}: </span>
                  {fmt(incident.riddorSubmittedAt, locale)} ·{' '}
                  {nameOf(incident.riddorSubmittedByUserId)}
                  {' · '}
                  {incident.riddorSubmissionRoute === 'phone'
                    ? t('riddor.routePhone')
                    : t('riddor.routeOnline')}
                  {incident.riddorHseReference !== null ? ` · ${incident.riddorHseReference}` : ''}
                </p>
              ) : null}
            </div>
          )}

          {panel === 'screen' ? (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">{t('riddor.screenHint')}</p>
              {/* The over-7-day trigger is a CLOCK, not a judgement — the
                  one part of RIDDOR a computer should own outright. The
                  lost-time figure was recorded two panels up and the one
                  screen that needs it ignored it entirely. */}
              {data.daysLost > 0 ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  {(() => {
                    // reg 4(2): more than seven CONSECUTIVE days, not
                    // counting the day of the accident. So the duty bites
                    // on the eighth day lost.
                    if (data.daysLost > 7)
                      return t('riddor.lostTimeOverSeven', { days: data.daysLost });
                    const ongoing = data.absences.some((a) => a.toDate === null);
                    if (!ongoing) return t('riddor.lostTimeRecorded', { days: data.daysLost });
                    const crossesAt = new Date(Date.now() + (8 - data.daysLost) * 86_400_000);
                    return t('riddor.lostTimeOngoing', {
                      days: data.daysLost,
                      date: formatDate(crossesAt, locale),
                    });
                  })()}
                </p>
              ) : null}
              <div className="space-y-1.5">
                {RIDDOR_CATEGORIES.map((category) => (
                  <label
                    key={category}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm ${
                      screenCategory === category ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="riddor-category"
                      className="mt-0.5"
                      checked={screenCategory === category}
                      onChange={() => setScreenCategory(category)}
                    />
                    <span>
                      <span className="font-medium">
                        {t(`riddor.categories.${category}` as never)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t(`riddor.help.${category}` as never)}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label>{t('riddor.note')}</Label>
                <Textarea
                  value={screenNote}
                  onChange={(e) => setScreenNote(e.target.value)}
                  placeholder={t('riddor.notePlaceholder')}
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  disabled={
                    screenCategory === '' || screenNote.trim() === '' || screenMutation.isPending
                  }
                  onClick={() =>
                    screenMutation.mutate({
                      incidentId,
                      category: screenCategory as never,
                      determinationNote: screenNote.trim(),
                    })
                  }
                >
                  {t('riddor.confirmScreen')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setPanel('none')}>
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : null}

          {canManage &&
          incident.riddorCategory !== null &&
          isRiddorReportable(incident.riddorCategory) &&
          incident.riddorSubmittedAt === null ? (
            panel === 'submitRiddor' ? (
              <div className="space-y-3 rounded-md border p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t('riddor.route')}</Label>
                    <select
                      value={subRoute}
                      onChange={(e) => setSubRoute(e.target.value as 'online' | 'phone')}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="online">{t('riddor.routeOnline')}</option>
                      <option value="phone">{t('riddor.routePhone')}</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('riddor.hseReference')}</Label>
                    <Input value={subRef} onChange={(e) => setSubRef(e.target.value)} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    disabled={submitRiddorMutation.isPending}
                    onClick={() =>
                      submitRiddorMutation.mutate({
                        incidentId,
                        route: subRoute,
                        hseReference: subRef.trim(),
                      })
                    }
                  >
                    {t('riddor.confirmSubmission')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPanel('none')}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" onClick={() => setPanel('submitRiddor')}>
                {t('riddor.recordSubmission')}
              </Button>
            )
          ) : null}
        </CardContent>
      </Card>

      {/* ── Investigation ── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{t('investigation.heading')}</h2>
            <div className="flex items-center gap-2">
              {(incident.status === 'triaged' || incident.status === 'reopened') &&
              canInvestigate ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={startInvestigationMutation.isPending}
                  onClick={() => startInvestigationMutation.mutate({ incidentId })}
                >
                  <Microscope className="mr-1.5 h-4 w-4" />
                  {t('investigation.start')}
                </Button>
              ) : null}
              {latestInvestigation !== undefined ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/${locale}/incidents/${incidentId}/investigation`}>
                    {t('investigation.openWorkspace')}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
          {latestInvestigation === undefined ? (
            <p className="text-sm text-muted-foreground">
              {incident.status === 'reported'
                ? t('investigation.awaitingTriage')
                : t('investigation.notStarted')}
            </p>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-x-1.5">
                <span className="text-muted-foreground">{t('investigation.level')}: </span>
                {incident.investigationLevel !== null
                  ? t(`triage.levels.${incident.investigationLevel}` as never)
                  : '—'}
                {/* IN-A3b: upgrade path — basic can always step up. */}
                {canManage && !isTerminal && incident.investigationLevel === 'basic' ? (
                  <button
                    type="button"
                    disabled={setLevelMutation.isPending}
                    onClick={() => setLevelMutation.mutate({ incidentId, level: 'full' })}
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    {t('investigation.upgradeLevel')}
                  </button>
                ) : null}
                <span className="text-muted-foreground"> · {t('investigation.lead')}: </span>
                {nameOf(incident.leadInvestigatorUserId)}
                {/* IN-A7: the lead can be reassigned any time — leave on
                    holiday must not strand the incident. */}
                {canManage && !isTerminal ? (
                  <button
                    type="button"
                    onClick={() => {
                      setLeadValue(
                        incident.leadInvestigatorUserId === null
                          ? []
                          : [incident.leadInvestigatorUserId],
                      );
                      setShowReassign(!showReassign);
                    }}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {t('detail.change')}
                  </button>
                ) : null}
              </p>
              {showReassign ? (
                <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
                  <div className="min-w-56 flex-1">
                    <GroupUserSelector
                      value={leadValue}
                      onChange={setLeadValue}
                      mode="users"
                      multiple={false}
                      label={t('investigation.reassignLead')}
                      placeholder={t('triage.leadPlaceholder')}
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      leadValue[0] === undefined ||
                      leadValue[0] === incident.leadInvestigatorUserId ||
                      assignInvestigatorMutation.isPending
                    }
                    onClick={() => {
                      assignInvestigatorMutation.mutate({
                        incidentId,
                        userId: leadValue[0] ?? '',
                      });
                      setShowReassign(false);
                    }}
                  >
                    {t('common.save')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowReassign(false)}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : null}
              <p>
                <span className="text-muted-foreground">{t('investigation.revision')}: </span>
                {latestInvestigation.revision}
                {' · '}
                <span className="text-muted-foreground">{t('investigation.status')}: </span>
                {t(`investigation.statuses.${latestInvestigation.status}` as never)}
              </p>
              {latestInvestigation.status === 'approved' ? (
                <p className="text-muted-foreground">
                  {t('investigation.approvedBy', {
                    name: nameOf(latestInvestigation.approvedByUserId),
                    date: fmt(latestInvestigation.approvedAt, locale),
                  })}
                </p>
              ) : null}
              {latestInvestigation.conclusionSummary !== '' ? (
                <p className="whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">
                  {latestInvestigation.conclusionSummary}
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Findings & actions ── */}
      {data.findings.length > 0 || data.actions.length > 0 ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('findings.heading')}</h2>
            {data.findings.map((finding) => {
              const action = data.actions.find((a) => a.id === finding.actionId);
              return (
                <div key={finding.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{finding.description}</p>
                    <span className="text-xs text-muted-foreground">
                      {t(`causalFactors.${finding.category}` as never)} ·{' '}
                      {t(`priorities.${finding.priority}` as never)}
                    </span>
                  </div>
                  {action !== undefined ? (
                    <Link
                      href={`/${locale}/actions/${action.id}`}
                      className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {action.referenceNumber ?? action.id.slice(-6)} ·{' '}
                      {t(`findings.actionStatuses.${action.status}` as never)}
                      {action.dueAt !== null ? ` · ${fmtDate(action.dueAt, locale)}` : ''}
                    </Link>
                  ) : finding.requiresAction ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('findings.actionPending')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Linked records + review prompts ── */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">{t('linked.heading')}</h2>
          <div className="space-y-1 text-sm">
            {data.observation !== null ? (
              <p>
                <span className="text-muted-foreground">{t('linked.observation')}: </span>
                <Link
                  href={`/${locale}/observations/${data.observation.id}`}
                  className="text-primary hover:underline"
                >
                  {data.observation.referenceNumber ?? data.observation.id.slice(-6)} —{' '}
                  {data.observation.title}
                </Link>
              </p>
            ) : null}
            {data.permit !== null ? (
              <p>
                <span className="text-muted-foreground">{t('linked.permit')}: </span>
                <Link
                  href={`/${locale}/permits/${data.permit.id}`}
                  className="text-primary hover:underline"
                >
                  {data.permit.referenceNumber ?? data.permit.id.slice(-6)} — {data.permit.title}
                </Link>
              </p>
            ) : null}
            {data.contractor !== null ? (
              <p>
                <span className="text-muted-foreground">{t('linked.contractor')}: </span>
                {data.contractor.name}
              </p>
            ) : null}
            {data.asset !== null ? (
              <p>
                <span className="text-muted-foreground">{t('linked.asset')}: </span>
                {data.asset.name}
              </p>
            ) : null}
            {data.observation === null &&
            data.permit === null &&
            data.contractor === null &&
            data.asset === null ? (
              <p className="text-muted-foreground">{t('linked.none')}</p>
            ) : null}
          </div>

          {incident.reviewPromptAt !== null ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              {t('reviews.prompted', { date: fmt(incident.reviewPromptAt, locale) })}
            </p>
          ) : incident.reviewPromptSkippedReason !== null ? (
            <p className="text-sm text-muted-foreground">
              {t('reviews.skipped', { reason: incident.reviewPromptSkippedReason })}
            </p>
          ) : null}

          {canManage && reviewStepOpen && candidates !== undefined ? (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-sm font-medium">{t('reviews.stepHeading')}</p>
              <p className="text-xs text-muted-foreground">{t('reviews.stepHint')}</p>
              {(
                [
                  ['ra', candidates.riskAssessments, selectedRas, setSelectedRas],
                  ['coshh', candidates.coshhAssessments, selectedCoshh, setSelectedCoshh],
                  ['fra', candidates.fras, selectedFras, setSelectedFras],
                ] as const
              ).map(([kindKey, list, selected, setSelected]) =>
                list.length > 0 ? (
                  <div key={kindKey} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t(`reviews.kinds.${kindKey}` as never)}
                    </p>
                    <div className="max-h-40 space-y-0.5 overflow-y-auto">
                      {list.map((item) => (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selected.includes(item.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, item.id]
                                  : selected.filter((id) => id !== item.id),
                              )
                            }
                          />
                          <span>
                            {item.referenceNumber !== null ? `${item.referenceNumber} — ` : ''}
                            {item.title}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null,
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    selectedRas.length + selectedCoshh.length + selectedFras.length === 0 ||
                    promptReviewsMutation.isPending
                  }
                  onClick={() =>
                    promptReviewsMutation.mutate({
                      incidentId,
                      riskAssessmentIds: selectedRas,
                      coshhAssessmentIds: selectedCoshh,
                      fraIds: selectedFras,
                    })
                  }
                >
                  {t('reviews.promptButton')}
                </Button>
                {showSkip ? (
                  <>
                    <Input
                      value={skipReason}
                      onChange={(e) => setSkipReason(e.target.value)}
                      placeholder={t('reviews.skipReasonPlaceholder')}
                      className="h-8 w-64"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={skipReason.trim().length < 3 || skipReviewsMutation.isPending}
                      onClick={() =>
                        skipReviewsMutation.mutate({ incidentId, reason: skipReason.trim() })
                      }
                    >
                      {t('reviews.confirmSkip')}
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowSkip(true)}>
                    {t('reviews.skipButton')}
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Effectiveness ── */}
      {incident.status === 'closed' && incident.effectivenessDueAt !== null ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('effectiveness.heading')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('effectiveness.due', { date: fmt(incident.effectivenessDueAt, locale) })}
            </p>
            {incident.effectivenessVerdict !== null ? (
              <p className="text-sm">
                <span className="text-muted-foreground">{t('effectiveness.verdict')}: </span>
                {t(`effectiveness.verdicts.${incident.effectivenessVerdict}` as never)}
                {incident.effectivenessNote !== '' ? ` — ${incident.effectivenessNote}` : ''}
              </p>
            ) : canManage ? (
              panel === 'effectiveness' ? (
                <div className="space-y-3">
                  <p className="text-sm">{t('effectiveness.question')}</p>
                  <select
                    value={effVerdict}
                    onChange={(e) => setEffVerdict(e.target.value)}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {(['effective', 'partially_effective', 'not_effective'] as const).map((v) => (
                      <option key={v} value={v}>
                        {t(`effectiveness.verdicts.${v}` as never)}
                      </option>
                    ))}
                  </select>
                  <Textarea
                    value={effNote}
                    onChange={(e) => setEffNote(e.target.value)}
                    placeholder={t('effectiveness.notePlaceholder')}
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={effectivenessMutation.isPending}
                      onClick={() =>
                        effectivenessMutation.mutate({
                          incidentId,
                          verdict: effVerdict as never,
                          note: effNote.trim(),
                        })
                      }
                    >
                      {t('effectiveness.record')}
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setPanel('none')}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" variant="outline" onClick={() => setPanel('effectiveness')}>
                  {t('effectiveness.open')}
                </Button>
              )
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Lifecycle actions ── */}
      {canManage || incident.status === 'reported' ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">{t('lifecycle.heading')}</h2>
            <div className="flex flex-wrap gap-2">
              {canManage && incident.status === 'actions_outstanding' ? (
                <Button type="button" onClick={() => setPanel('close')}>
                  {t('lifecycle.close')}
                </Button>
              ) : null}
              {canManage && incident.status === 'closed' ? (
                <Button type="button" variant="outline" onClick={() => setPanel('reopen')}>
                  {t('lifecycle.reopen')}
                </Button>
              ) : null}
              {!isTerminal ? (
                <Button type="button" variant="outline" onClick={() => setPanel('cancel')}>
                  {t('lifecycle.cancel')}
                </Button>
              ) : null}
            </div>
            {panel === 'close' ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm text-muted-foreground">{t('lifecycle.closeHint')}</p>
                <Button
                  type="button"
                  disabled={closeMutation.isPending}
                  onClick={() => closeMutation.mutate({ incidentId })}
                >
                  {t('lifecycle.confirmClose')}
                </Button>
              </div>
            ) : null}
            {panel === 'reopen' || panel === 'cancel' ? (
              <div className="space-y-2 rounded-md border p-3">
                <Label>
                  {panel === 'reopen' ? t('lifecycle.reopenReason') : t('lifecycle.cancelReason')}
                </Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={panel === 'cancel' ? 'destructive' : 'default'}
                    disabled={reason.trim().length < 3}
                    onClick={() => {
                      if (panel === 'reopen') {
                        reopenMutation.mutate({ incidentId, reason: reason.trim() });
                      } else {
                        cancelMutation.mutate({ incidentId, reason: reason.trim() });
                      }
                      setReason('');
                    }}
                  >
                    {panel === 'reopen'
                      ? t('lifecycle.confirmReopen')
                      : t('lifecycle.confirmCancel')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setPanel('none')}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* ── Timeline ── */}
      <Card>
        <CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">{t('timeline.heading')}</h2>
          <div className="space-y-1.5">
            {data.events.map((event) => {
              const detailLine = describeEvent(event.kind, event.detail);
              return (
                <div key={event.id} className="text-sm">
                  <div className="flex items-baseline gap-2">
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {fmt(event.createdAt, locale)}
                    </span>
                    <span>{t(`events.${event.kind}` as never)}</span>
                    <span className="text-xs text-muted-foreground">
                      {event.actorUserId === 'system'
                        ? t('timeline.system')
                        : nameOf(event.actorUserId)}
                    </span>
                  </div>
                  {detailLine !== null ? (
                    <p className="pl-4 text-xs text-muted-foreground">{detailLine}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
