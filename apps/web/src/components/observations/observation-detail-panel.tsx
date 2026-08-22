'use client';

import type { IssueStatusValue } from '@forma360/shared/issues-schema';
import {
  Archive,
  CheckCircle2,
  Clock,
  ExternalLink,
  Paperclip,
  Pencil,
  Plus,
  Upload,
  X,
  ImageIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { SiteSelector } from '../selectors/site-selector';
import { usePlaceTerms } from '../../lib/terminology';
import { GroupUserSelector } from '../selectors/group-user-selector';
import { Button } from '../ui/button';
import { appConfirm } from '../ui/app-confirm';
import { Card, CardContent } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Skeleton } from '../ui/skeleton';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/cn';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { DetailNotFound } from '../detail-not-found';
import { ObservationCommentComposer } from './observation-comment-composer';
import { formatDate, formatDateTime } from '../../lib/format-date';
import { useServerErrorToast } from '../../lib/use-server-error';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'activity' | 'files' | 'actions' | 'inspections';
type Priority = 'low' | 'medium' | 'high' | 'critical';

const PRIORITIES: ReadonlyArray<Priority> = ['low', 'medium', 'high', 'critical'];

const PRIORITY_DOT_CLASS: Record<Priority, string> = {
  low: 'bg-slate-400',
  medium: 'bg-amber-400',
  high: 'bg-orange-500',
  critical: 'bg-red-600',
};

const STATUS_COLORS: Record<IssueStatusValue, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  investigation: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
};

// ── Main panel ────────────────────────────────────────────────────────────────

export function ObservationDetailPanel({
  observationId,
  locale,
}: {
  observationId: string;
  locale: string;
}) {
  const t = useTranslations('issues.detail');
  const tFields = useTranslations('issues.detail.fields');
  const { label: placeLabel } = usePlaceTerms();
  const tStatus = useTranslations('issues.status');
  const tPriority = useTranslations('issues.priority');
  const tReportedVia = useTranslations('issues.reportedVia');
  const tCommon = useTranslations('common');
  const onServerError = useServerErrorToast(tCommon('error'));
  const utils = trpc.useUtils();
  const canManage = useHasPermission('issues.manage');

  const [tab, setTab] = useState<Tab>('overview');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [addActionOpen, setAddActionOpen] = useState(false);
  const [attachInspectionOpen, setAttachInspectionOpen] = useState(false);

  const issueId = observationId;

  const { data, isLoading, error } = trpc.issues.issues.get.useQuery({ issueId });
  const { data: sites } = trpc.sites.list.useQuery();
  const { data: users } = trpc.users.list.useQuery({});

  const update = trpc.issues.issues.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      void utils.issues.issues.get.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
      void utils.issues.issues.list.invalidate();
    },
    onError: onServerError,
  });

  const close = trpc.issues.issues.close.useMutation({
    onSuccess: () => {
      toast.success(t('closeToast'));
      setCloseOpen(false);
      void utils.issues.issues.get.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
      void utils.issues.issues.list.invalidate();
    },
    onError: onServerError,
  });

  const reopen = trpc.issues.issues.reopen.useMutation({
    onSuccess: () => {
      toast.success(t('reopenToast'));
      void utils.issues.issues.get.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
      void utils.issues.issues.list.invalidate();
    },
    onError: onServerError,
  });

  const setStatus = trpc.issues.issues.setStatus.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      void utils.issues.issues.get.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
      void utils.issues.issues.list.invalidate();
    },
    onError: onServerError,
  });

  const archive = trpc.issues.issues.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      setArchiveOpen(false);
      void utils.issues.issues.get.invalidate({ issueId });
      void utils.issues.issues.list.invalidate();
    },
    onError: onServerError,
  });

  // Error check first: on error `data` is undefined, so a bare loading gate
  // below would loop the skeleton forever once the query has settled.
  if (error !== null && error !== undefined) {
    return (
      <div className="p-6">
        <DetailNotFound error={error} />
      </div>
    );
  }

  if (isLoading || data === undefined) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const issue = data.issue;
  const siteName =
    issue.siteId !== null ? ((sites ?? []).find((s) => s.id === issue.siteId)?.name ?? '—') : '—';
  const assignee =
    issue.assigneeUserId !== null && issue.assigneeUserId !== undefined
      ? (users?.users ?? []).find((u) => u.id === issue.assigneeUserId)
      : undefined;

  const priority = (issue.priority ?? null) as Priority | null;
  const issueDescription = issue.description ?? '';
  const normalStatus: IssueStatusValue =
    issue.status === 'open' || issue.status === 'investigation' || issue.status === 'closed'
      ? issue.status
      : 'open';

  function startEditDescription() {
    setDescriptionDraft(issueDescription);
    setEditingDescription(true);
  }

  function saveDescription() {
    const next = descriptionDraft.trim();
    if (next === issueDescription) {
      setEditingDescription(false);
      return;
    }
    update.mutate({ issueId, description: next.length > 0 ? next : null });
    setEditingDescription(false);
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="shrink-0 border-b px-6 py-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
            {issue.referenceNumber}
          </span>

          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1">
                  <span
                    className={cn(
                      'rounded-md px-2 py-0.5 text-xs font-medium',
                      STATUS_COLORS[normalStatus],
                    )}
                  >
                    {tStatus(normalStatus)}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {normalStatus === 'open' ? (
                  <DropdownMenuItem
                    onSelect={() => setStatus.mutate({ issueId, status: 'investigation' })}
                  >
                    {tStatus('investigation')}
                  </DropdownMenuItem>
                ) : null}
                {normalStatus === 'investigation' ? (
                  <DropdownMenuItem onSelect={() => setStatus.mutate({ issueId, status: 'open' })}>
                    {tStatus('open')}
                  </DropdownMenuItem>
                ) : null}
                {normalStatus !== 'closed' ? (
                  <DropdownMenuItem onSelect={() => setCloseOpen(true)}>
                    {tStatus('closed')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => reopen.mutate({ issueId })}>
                    {tStatus('open')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-medium',
                STATUS_COLORS[normalStatus],
              )}
            >
              {tStatus(normalStatus)}
            </span>
          )}
        </div>

        <div className="flex items-start justify-between gap-3">
          <h2 className="flex-1 text-lg font-semibold leading-snug tracking-tight">
            {issue.title}
          </h2>

          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/${locale}/observations/${observationId}`}>
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="sr-only">{t('openFullPage')}</span>
              </Link>
            </Button>
            {canManage ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setArchiveOpen(true)}
                disabled={archive.isPending}
              >
                <Archive className="h-3.5 w-3.5" />
                <span className="sr-only">{t('archiveButton')}</span>
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="mt-3 flex gap-1 border-b border-slate-300 dark:border-slate-700">
          {(['overview', 'activity', 'files', 'actions', 'inspections'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === key
                  ? 'border-[#234fe1] text-[#234fe1] font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`tabs.${key}`)}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'overview' ? (
          <div className="space-y-4 p-6">
            <Card>
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t('descriptionTitle')}</h3>
                  {canManage && !editingDescription ? (
                    <Button type="button" variant="ghost" size="sm" onClick={startEditDescription}>
                      <Pencil className="mr-1 h-3 w-3" />
                      {t('editButton')}
                    </Button>
                  ) : null}
                </div>
                {editingDescription ? (
                  <div className="space-y-2">
                    <Textarea
                      value={descriptionDraft}
                      onChange={(e) => setDescriptionDraft(e.target.value)}
                      rows={4}
                      maxLength={20_000}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingDescription(false)}
                      >
                        {tCommon('cancel')}
                      </Button>
                      <Button type="button" size="sm" onClick={saveDescription}>
                        {tCommon('save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {issueDescription.length > 0 ? issueDescription : '—'}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-4 p-5">
                <h3 className="text-sm font-semibold">{t('detailsTitle')}</h3>
                <dl className="space-y-3">
                  <DetailRow label={tFields('category')}>
                    <span className="inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                      {issue.categorySnapshot.name}
                    </span>
                  </DetailRow>
                  <DetailRow label={placeLabel}>
                    {canManage ? (
                      <SiteSelector
                        value={
                          issue.siteId !== null && issue.siteId !== undefined ? [issue.siteId] : []
                        }
                        onChange={(next) => update.mutate({ issueId, siteId: next[0] ?? null })}
                        multiple={false}
                        placeholder="—"
                      />
                    ) : (
                      <span className="text-sm">{siteName}</span>
                    )}
                  </DetailRow>
                  <DetailRow label={tFields('assignee')}>
                    <AssigneePicker
                      currentId={issue.assigneeUserId ?? null}
                      currentName={assignee?.name ?? null}
                      canManage={canManage}
                      onChange={(next) => update.mutate({ issueId, assigneeUserId: next })}
                      tFields={tFields}
                    />
                  </DetailRow>
                  <DetailRow label={tFields('priority')}>
                    {canManage ? (
                      <select
                        value={priority ?? ''}
                        onChange={(e) =>
                          update.mutate({
                            issueId,
                            priority: e.target.value === '' ? null : (e.target.value as Priority),
                          })
                        }
                        className="block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="">{t('fields.noPriority')}</option>
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {tPriority(p)}
                          </option>
                        ))}
                      </select>
                    ) : priority !== null ? (
                      <span className="inline-flex items-center gap-2 text-sm">
                        <span
                          className={cn('h-2 w-2 rounded-full', PRIORITY_DOT_CLASS[priority])}
                        />
                        {tPriority(priority)}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {t('fields.noPriority')}
                      </span>
                    )}
                  </DetailRow>
                  <DetailRow label={tFields('dueDate')}>
                    {canManage ? (
                      <Input
                        type="datetime-local"
                        value={toLocalDatetime(issue.dueAt ?? null)}
                        onChange={(e) => {
                          const iso =
                            e.target.value === '' ? null : new Date(e.target.value).toISOString();
                          update.mutate({ issueId, dueAt: iso });
                        }}
                        className="h-8 text-sm"
                      />
                    ) : issue.dueAt !== null && issue.dueAt !== undefined ? (
                      <span className="text-sm">{formatDate(issue.dueAt)}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t('fields.noDueDate')}</span>
                    )}
                  </DetailRow>
                  <DetailRow label={tFields('dateOccurred')}>
                    {canManage ? (
                      <Input
                        type="datetime-local"
                        value={toLocalDatetime(issue.dateOccurred)}
                        onChange={(e) => {
                          if (e.target.value === '') return;
                          update.mutate({
                            issueId,
                            dateOccurred: new Date(e.target.value).toISOString(),
                          });
                        }}
                        className="h-8 text-sm"
                      />
                    ) : (
                      <span className="text-sm">{formatDate(issue.dateOccurred)}</span>
                    )}
                  </DetailRow>
                  <DetailRow label={tFields('reportedVia')}>
                    <span className="text-sm">
                      {tReportedVia(issue.reportedVia as 'app' | 'qr')}
                    </span>
                  </DetailRow>
                </dl>
              </CardContent>
            </Card>

            {data.categorySnapshot.customQuestions.length > 0 ? (
              <Card>
                <CardContent className="space-y-3 p-5 text-sm">
                  <h3 className="text-sm font-semibold">{t('customQuestionsTitle')}</h3>
                  <dl className="space-y-2">
                    {data.categorySnapshot.customQuestions.map((q) => (
                      <div key={q.id} className="space-y-1">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          {q.prompt}
                        </dt>
                        <dd className="text-sm">
                          {formatValue(issue.customQuestionResponses[q.id])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardContent className="space-y-1 p-5 text-sm">
                <h3 className="text-sm font-semibold">{t('metaReportedBy')}</h3>
                <p className="text-muted-foreground">
                  {issue.reportedByName ?? t('reportedAnonymous')}
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(issue.createdAt)}</p>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {tab === 'activity' ? (
          <div className="space-y-4 p-6">
            <ObservationCommentComposer
              observationId={issueId}
              onAdded={() => {
                void utils.issues.activity.list.invalidate({ issueId });
                void utils.issues.issues.get.invalidate({ issueId });
              }}
            />
            <ActivityTimeline issueId={issueId} />
          </div>
        ) : null}

        {tab === 'files' ? (
          <div className="p-6">
            <AttachmentsCard issueId={issueId} canManage={canManage} />
          </div>
        ) : null}

        {tab === 'actions' ? (
          <div className="p-6">
            <LinkedActionsCard
              issueId={issueId}
              canManage={canManage}
              onOpenAdd={() => setAddActionOpen(true)}
              locale={locale}
            />
          </div>
        ) : null}

        {tab === 'inspections' ? (
          <div className="p-6">
            <LinkedInspectionsCard
              issueId={issueId}
              canManage={canManage}
              onOpenAttach={() => setAttachInspectionOpen(true)}
              locale={locale}
            />
          </div>
        ) : null}
      </div>

      {/* ── Bottom action bar ── */}
      {canManage ? (
        <div className="shrink-0 border-t bg-background px-6 py-3 flex items-center gap-2">
          <Button size="sm" onClick={() => setAddActionOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('actions.addAction')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAttachInspectionOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('actions.addInspection')}
          </Button>
        </div>
      ) : null}

      {/* ── Dialogs ── */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('closeDialogTitle')}</DialogTitle>
            <DialogDescription>{t('closeDialogBody')}</DialogDescription>
          </DialogHeader>
          <CloseForm
            onSubmit={(reason) => {
              const input: { issueId: string; reason?: string } = { issueId };
              if (reason.length > 0) input.reason = reason;
              close.mutate(input);
            }}
            onCancel={() => setCloseOpen(false)}
            isPending={close.isPending}
            reasonPlaceholder={t('closeReasonPlaceholder')}
            cancelLabel={tCommon('cancel')}
            confirmLabel={t('closeButton')}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('archiveConfirmTitle')}</DialogTitle>
            <DialogDescription>{t('archiveConfirmBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setArchiveOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => archive.mutate({ issueId })}
              disabled={archive.isPending}
            >
              {t('archiveButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {addActionOpen ? (
        <AddActionDialog
          open={addActionOpen}
          onOpenChange={setAddActionOpen}
          issueId={issueId}
          onCreated={() => {
            void utils.issues.activity.list.invalidate({ issueId });
          }}
        />
      ) : null}

      {attachInspectionOpen ? (
        <AttachInspectionDialog
          open={attachInspectionOpen}
          onOpenChange={setAttachInspectionOpen}
          issueId={issueId}
          onCreated={(_inspectionId) => {
            void utils.inspections.list.invalidate();
            void utils.issues.activity.list.invalidate({ issueId });
          }}
          locale={locale}
        />
      ) : null}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 items-start">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground pt-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function AssigneePicker({
  currentId,
  currentName,
  canManage,
  onChange,
  tFields,
}: {
  currentId: string | null;
  currentName: string | null;
  canManage: boolean;
  onChange: (next: string | null) => void;
  tFields: (k: string) => string;
}) {
  if (!canManage) {
    return (
      <span className="text-sm">
        {currentName !== null && currentName.length > 0 ? currentName : tFields('noAssignee')}
      </span>
    );
  }

  return (
    <GroupUserSelector
      mode="users"
      multiple={false}
      value={currentId !== null ? [currentId] : []}
      onChange={(next) => onChange(next[0] ?? null)}
      placeholder={tFields('pickUser')}
    />
  );
}

function ActivityTimeline({ issueId }: { issueId: string }) {
  const t = useTranslations('issues.detail');
  const tEvents = useTranslations('issues.detail.activity.events');
  const tPriority = useTranslations('issues.priority');
  const tStatus = useTranslations('issues.status');
  const { data } = trpc.issues.activity.list.useQuery({ issueId });
  if (data === undefined) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {t('activity.empty')}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <ul className="space-y-3">
          {data.map((event) => {
            const actor = event.actorName ?? t('activity.systemActor');
            const initial = (actor[0] ?? '?').toUpperCase();
            const sentence = describeActivity(event, tEvents, tPriority, tStatus);
            return (
              <li key={event.id} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
                  {initial}
                </span>
                <div className="flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{actor}</span>{' '}
                    <span className="text-muted-foreground">{sentence}</span>
                  </p>
                  {event.kind === 'commented' ? (
                    <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                      {String((event.payload as Record<string, unknown>).body ?? '')}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{formatDate(event.createdAt)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function AttachmentsCard({ issueId, canManage }: { issueId: string; canManage: boolean }) {
  const t = useTranslations('issues.detail');
  const tAttachments = useTranslations('issues.attachments');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const { data } = trpc.issues.attachments.list.useQuery({ issueId });
  const create = trpc.issues.attachments.create.useMutation({
    onSuccess: () => {
      void utils.issues.attachments.list.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
    },
    onError: () => toast.error(tAttachments('uploadError')),
  });
  const remove = trpc.issues.attachments.delete.useMutation({
    onSuccess: () => {
      void utils.issues.attachments.list.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
    },
    onError: () => toast.error(tCommon('error')),
  });
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadOne(file: File) {
    const form = new FormData();
    form.set('issueId', issueId);
    form.set('file', file);
    setUploading(true);
    try {
      const res = await fetch('/api/upload/observation-attachment', { method: 'POST', body: form });
      if (!res.ok) {
        toast.error(tAttachments('uploadError'));
        return;
      }
      const json = (await res.json()) as {
        storageKey: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
      };
      await create.mutateAsync({
        issueId,
        storageKey: json.storageKey,
        filename: json.filename,
        mimeType: json.mimeType,
        sizeBytes: json.sizeBytes,
      });
    } catch {
      toast.error(tAttachments('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (files === null || files.length === 0) return;
    for (const file of Array.from(files)) {
      await uploadOne(file);
    }
  }

  const rows = data ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h3 className="text-sm font-semibold">{t('filesTitle')}</h3>
        {canManage ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFiles(e.dataTransfer.files);
            }}
            className={cn(
              'flex items-center justify-center rounded-md border border-dashed p-4 text-sm transition-colors',
              dragOver ? 'border-primary bg-accent/50' : 'border-muted bg-muted/30',
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,application/pdf"
              className="hidden"
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-1 h-4 w-4" />
              {uploading ? tAttachments('uploading') : tAttachments('dropZone')}
            </Button>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tAttachments('emptyBody')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2">
            {rows.map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-md border p-2 text-sm">
                <AttachmentThumb mimeType={a.mimeType} signedUrl={a.signedUrl} />
                <div className="min-w-0 flex-1">
                  <a
                    href={a.signedUrl ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-medium hover:underline"
                  >
                    {a.filename}
                  </a>
                  <p className="text-xs text-muted-foreground">{formatSize(a.sizeBytes)}</p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                    aria-label={tAttachments('deleteAction')}
                    onClick={() => {
                      void appConfirm({
                        description: tAttachments('deleteConfirm'),
                        destructive: true,
                      }).then((ok) => {
                        if (ok) remove.mutate({ attachmentId: a.id });
                      });
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AttachmentThumb({ mimeType, signedUrl }: { mimeType: string; signedUrl: string | null }) {
  if (mimeType.startsWith('image/') && signedUrl !== null) {
    return <img src={signedUrl} alt="" className="h-10 w-10 flex-shrink-0 rounded object-cover" />;
  }
  return (
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-muted">
      {mimeType.startsWith('image/') ? (
        <ImageIcon className="h-5 w-5 text-muted-foreground" />
      ) : (
        <Paperclip className="h-5 w-5 text-muted-foreground" />
      )}
    </span>
  );
}

const ACTION_STATUS_BADGE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  cancelled: 'bg-muted text-muted-foreground',
};

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-100',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  low: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

function LinkedActionsCard({
  issueId,
  canManage,
  onOpenAdd,
  locale,
}: {
  issueId: string;
  canManage: boolean;
  onOpenAdd: () => void;
  locale: string;
}) {
  const t = useTranslations('issues.detail');
  const tPriority = useTranslations('issues.priority');
  const tActionStatus = useTranslations('actions.status');
  const { data, isLoading } = trpc.actions.list.useQuery({
    sourceType: 'issue',
    sourceId: issueId,
  });
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-3">
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('linkedActionsEmpty')}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const overdue =
              row.dueAt !== null &&
              row.status !== 'completed' &&
              row.status !== 'cancelled' &&
              new Date(row.dueAt).getTime() < Date.now();
            return (
              <Link
                key={row.id}
                href={`/${locale}/actions/${row.id}`}
                className="block rounded-lg border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow-md"
              >
                {/* Reference + source badge */}
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5">{t('sourceBadge')}</span>
                  <span className="font-mono">{row.referenceNumber ?? row.id.slice(-6)}</span>
                </div>
                {/* Title */}
                <p className="line-clamp-2 font-medium">{row.title}</p>
                {/* Type badge */}
                {row.actionTypeName !== null ? (
                  <div className="mt-1 flex items-center gap-1">
                    <span className="inline-flex items-center gap-1 rounded-full border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {row.actionTypeColor !== null && row.actionTypeColor.length > 0 ? (
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: row.actionTypeColor }}
                          aria-hidden="true"
                        />
                      ) : null}
                      {row.actionTypeName}
                    </span>
                  </div>
                ) : null}
                {/* Status + priority + due */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 font-medium',
                      ACTION_STATUS_BADGE[row.status] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {row.status === 'open' ||
                    row.status === 'in_progress' ||
                    row.status === 'completed' ||
                    row.status === 'cancelled'
                      ? tActionStatus(row.status)
                      : row.status}
                  </span>
                  {row.priority !== null && row.priority in PRIORITY_BADGE ? (
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 font-medium',
                        PRIORITY_BADGE[row.priority] ?? '',
                      )}
                    >
                      {row.priority === 'low' ||
                      row.priority === 'medium' ||
                      row.priority === 'high' ||
                      row.priority === 'critical'
                        ? tPriority(row.priority)
                        : row.priority}
                    </span>
                  ) : null}
                  {row.dueAt !== null ? (
                    <span
                      className={cn(
                        'flex items-center gap-0.5',
                        overdue ? 'font-medium text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      <Clock className="h-3 w-3" />
                      {formatDate(row.dueAt)}
                    </span>
                  ) : null}
                  {row.assigneeName !== null ? (
                    <span className="text-muted-foreground">{row.assigneeName}</span>
                  ) : null}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      {canManage ? (
        <Button type="button" variant="outline" size="sm" onClick={onOpenAdd}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('actions.addAction')}
        </Button>
      ) : null}
    </div>
  );
}

function AddActionDialog({
  open,
  onOpenChange,
  issueId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  issueId: string;
  onCreated: () => void;
}) {
  const t = useTranslations('issues.detail.addActionDialog');
  const tPriority = useTranslations('issues.priority');
  const tCommon = useTranslations('common');
  const onServerError = useServerErrorToast(tCommon('error'));
  const utils = trpc.useUtils();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<'' | Priority>('');
  const [dueAt, setDueAt] = useState('');
  const [actionTypeId, setActionTypeId] = useState('');

  const { data: actionTypes } = trpc.actionTypes.list.useQuery({}, { enabled: open });

  const create = trpc.actions.createFromIssue.useMutation({
    onSuccess: () => {
      toast.success(t('toast'));
      void utils.actions.list.invalidate({ sourceType: 'issue', sourceId: issueId });
      onCreated();
      onOpenChange(false);
      setTitle('');
      setDescription('');
      setPriority('');
      setDueAt('');
      setActionTypeId('');
    },
    onError: onServerError,
  });

  const canSubmit = title.trim().length > 0 && !create.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit) return;
            const input: {
              issueId: string;
              title: string;
              description?: string;
              priority?: Priority;
              dueAt?: string;
            } = { issueId, title: title.trim() };
            if (description.trim().length > 0) input.description = description.trim();
            if (priority !== '') input.priority = priority;
            if (dueAt !== '') input.dueAt = new Date(dueAt).toISOString();
            create.mutate(input);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="act-title">{t('actionTitleLabel')}</Label>
            <Input
              id="act-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('actionTitlePlaceholder')}
              required
              autoFocus
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-type">{t('actionTypeLabel')}</Label>
            <select
              id="act-type"
              value={actionTypeId}
              onChange={(e) => setActionTypeId(e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('noActionType')}</option>
              {(actionTypes ?? []).map((at) => (
                <option key={at.id} value={at.id}>
                  {at.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="act-desc">{t('descriptionLabel')}</Label>
            <Textarea
              id="act-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={3}
              maxLength={20_000}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="act-priority">{t('priorityLabel')}</Label>
              <select
                id="act-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as '' | Priority)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">{t('noPriority')}</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {tPriority(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="act-due">{t('dueDateLabel')}</Label>
              <Input
                id="act-due"
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t('saveButton')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const INSPECTION_STATUS_BADGE: Record<string, string> = {
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  awaiting_signatures: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-100',
  awaiting_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
};

function LinkedInspectionsCard({
  issueId,
  canManage,
  onOpenAttach,
  locale,
}: {
  issueId: string;
  canManage: boolean;
  onOpenAttach: () => void;
  locale: string;
}) {
  const t = useTranslations('issues.detail');
  const tInspStatus = useTranslations('inspections.status');
  const { data, isLoading } = trpc.inspections.list.useQuery({ sourceIssueId: issueId });
  const rows = data ?? [];

  return (
    <div className="space-y-3">
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('inspectionsEmpty')}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={`/${locale}/inspections/${row.id}`}
              className="block rounded-lg border bg-card p-3 text-sm shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span className="font-mono">{row.documentNumber ?? row.id.slice(-6)}</span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-medium text-xs',
                    INSPECTION_STATUS_BADGE[row.status] ?? 'bg-muted text-muted-foreground',
                  )}
                >
                  {tInspStatus(
                    row.status as
                      | 'in_progress'
                      | 'awaiting_signatures'
                      | 'awaiting_approval'
                      | 'completed'
                      | 'rejected',
                  )}
                </span>
              </div>
              <p className="line-clamp-2 font-medium">{row.title}</p>
              {row.templateName !== null ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{row.templateName}</p>
              ) : null}
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                {row.completedAt !== null ? (
                  <span className="flex items-center gap-0.5">
                    <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                    {formatDate(row.completedAt)}
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    {formatDate(row.startedAt)}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      {canManage ? (
        <Button type="button" variant="outline" size="sm" onClick={onOpenAttach}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('actions.addInspection')}
        </Button>
      ) : null}
    </div>
  );
}

function AttachInspectionDialog({
  open,
  onOpenChange,
  issueId,
  onCreated,
  locale,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  issueId: string;
  onCreated: (inspectionId: string) => void;
  locale: string;
}) {
  const t = useTranslations('issues.detail.attachInspectionDialog');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const [selected, setSelected] = useState('');

  const { data: templates, isLoading } = trpc.templates.list.useQuery(
    { status: 'published' },
    { enabled: open },
  );

  const published = useMemo(
    () => (templates ?? []).filter((r) => r.currentVersionId !== null && r.archivedAt === null),
    [templates],
  );

  const create = trpc.inspections.create.useMutation({
    onSuccess: (res) => {
      toast.success(t('toast'));
      onCreated(res.inspectionId);
      onOpenChange(false);
      router.push(`/${locale}/inspections/${res.inspectionId}`);
    },
    onError: () => toast.error(t('createError')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[40vh] overflow-y-auto">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : published.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul className="space-y-1">
              {published.map((tpl) => (
                <li key={tpl.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
                    <input
                      type="radio"
                      name="insp-template"
                      checked={selected === tpl.id}
                      onChange={() => setSelected(tpl.id)}
                      className="h-4 w-4"
                    />
                    <span className="flex-1">
                      <span className="font-medium">{tpl.name}</span>
                      {tpl.description !== null ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {tpl.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button
            onClick={() => {
              if (selected.length !== 26 || create.isPending) return;
              create.mutate({ templateId: selected, sourceIssueId: issueId });
            }}
            disabled={selected.length !== 26 || create.isPending}
          >
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloseForm({
  onSubmit,
  onCancel,
  isPending,
  reasonPlaceholder,
  cancelLabel,
  confirmLabel,
}: {
  onSubmit: (reason: string) => void;
  onCancel: () => void;
  isPending: boolean;
  reasonPlaceholder: string;
  cancelLabel: string;
  confirmLabel: string;
}) {
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(reason.trim());
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="close-reason">{reasonPlaceholder}</Label>
        <Textarea
          id="close-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={isPending}>
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function describeActivity(
  event: { kind: string; payload: Record<string, unknown> },
  tEvents: (k: string, vars?: Record<string, string>) => string,
  tPriority: (k: 'low' | 'medium' | 'high' | 'critical') => string,
  tStatus: (k: 'open' | 'investigation' | 'closed') => string,
): string {
  const payload = event.payload;
  switch (event.kind) {
    case 'created':
      return tEvents('created');
    case 'status_changed': {
      const from = String(payload.from ?? '');
      const to = String(payload.to ?? '');
      return tEvents('statusChanged', {
        from: isStatus(from) ? tStatus(from) : from,
        to: isStatus(to) ? tStatus(to) : to,
      });
    }
    case 'priority_changed': {
      const to = payload.to as string | null;
      if (to === null || to === undefined) return tEvents('priorityChanged', { to: '—' });
      const label = isPriority(to) ? tPriority(to) : to;
      return tEvents('priorityChanged', { to: label });
    }
    case 'assignee_changed': {
      const to = payload.to as string | null;
      if (to === null || to === undefined || to === '') return tEvents('assigneeCleared');
      return tEvents('assigneeChanged', { to });
    }
    case 'due_date_changed': {
      const to = payload.to as string | null;
      if (to === null || to === undefined) return tEvents('dueDateCleared');
      return tEvents('dueDateChanged', { to: formatDateTime(to) });
    }
    case 'commented':
      return tEvents('commented');
    case 'attachment_added':
      return tEvents('attachmentAdded', { filename: String(payload.filename ?? '') });
    case 'attachment_removed':
      return tEvents('attachmentRemoved', { filename: String(payload.filename ?? '') });
    case 'edited':
      return tEvents('edited');
    default:
      return event.kind;
  }
}

function isPriority(v: string): v is 'low' | 'medium' | 'high' | 'critical' {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical';
}

function isStatus(v: string): v is 'open' | 'investigation' | 'closed' {
  return v === 'open' || v === 'investigation' || v === 'closed';
}

function formatValue(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v.length > 0 ? v : '—';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function toLocalDatetime(d: Date | string | null | undefined): string {
  if (d === null || d === undefined) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
