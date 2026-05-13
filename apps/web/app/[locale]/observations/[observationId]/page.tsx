'use client';

import {
  Archive,
  ArrowLeft,
  ChevronDown,
  FileText,
  ImageIcon,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../src/components/ui/dropdown-menu';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Observation detail view.
 *
 * SafetyCulture-style multi-tab layout:
 *   - Overview: two-column with details (left) + Location / Files /
 *     Inspections sidecards (right). Inline editable description and
 *     a structured Details card (category, site, assignee, priority,
 *     due date, date occurred, reference, reported via).
 *   - Activity: timeline of activity events (created, status changes,
 *     priority / assignee / due-date changes, comments, attachments).
 *   - Files: full grid of attachments with delete + signed-download.
 *   - Inspections / Actions: empty placeholders for future cross-module
 *     wiring.
 *
 * The backend tRPC namespace is still `issues.*`; URL + UI labels are
 * "Observations". The route segment is `[observationId]`; the tRPC
 * argument names continue to use `issueId`.
 */
type Tab = 'overview' | 'activity' | 'files' | 'inspections' | 'actions';
type Priority = 'low' | 'medium' | 'high' | 'critical';

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

const PRIORITY_DOT_CLASS: Record<Priority, string> = {
  low: 'bg-slate-400',
  medium: 'bg-amber-400',
  high: 'bg-orange-500',
  critical: 'bg-red-600',
};

export default function ObservationDetailPage() {
  const t = useTranslations('issues.detail');
  const tStatus = useTranslations('issues.status');
  const tPriority = useTranslations('issues.priority');
  const tReportedVia = useTranslations('issues.reportedVia');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; observationId: string }>();
  const locale = params.locale ?? 'en';
  const issueId = params.observationId ?? '';
  const router = useRouter();
  const utils = trpc.useUtils();

  const canManage = useHasPermission('issues.manage');

  const { data, isLoading, error } = trpc.issues.issues.get.useQuery(
    { issueId },
    { enabled: issueId.length > 0 },
  );
  const { data: sites } = trpc.sites.list.useQuery();
  const { data: users } = trpc.users.list.useQuery({});

  const [tab, setTab] = useState<Tab>('overview');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);

  const update = trpc.issues.issues.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      void utils.issues.issues.get.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const close = trpc.issues.issues.close.useMutation({
    onSuccess: () => {
      toast.success(t('closeToast'));
      setCloseOpen(false);
      void utils.issues.issues.get.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const reopen = trpc.issues.issues.reopen.useMutation({
    onSuccess: () => {
      toast.success(t('reopenToast'));
      void utils.issues.issues.get.invalidate({ issueId });
      void utils.issues.activity.list.invalidate({ issueId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const archive = trpc.issues.issues.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      router.push(`/${locale}/observations`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (isLoading || data === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error !== null && error !== undefined) {
    return (
      <div className="space-y-4">
        <Link
          href={`/${locale}/observations`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
        <p className="text-sm text-destructive">{error.message}</p>
      </div>
    );
  }

  const issue = data.issue;
  const siteName =
    issue.siteId !== null ? (sites ?? []).find((s) => s.id === issue.siteId)?.name ?? '—' : '—';
  const assignee =
    issue.assigneeUserId !== null && issue.assigneeUserId !== undefined
      ? (users?.users ?? []).find((u) => u.id === issue.assigneeUserId)
      : undefined;

  const priority = (issue.priority ?? null) as Priority | null;
  const issueDescription = issue.description ?? '';

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

  function updateAssignee(next: string | null) {
    update.mutate({ issueId, assigneeUserId: next });
  }

  function updatePriority(next: Priority | null) {
    update.mutate({ issueId, priority: next });
  }

  function updateDueAt(next: string) {
    const iso = next === '' ? null : new Date(next).toISOString();
    update.mutate({ issueId, dueAt: iso });
  }

  function updateDateOccurred(next: string) {
    if (next === '') return;
    update.mutate({ issueId, dateOccurred: new Date(next).toISOString() });
  }

  function updateSite(next: string) {
    update.mutate({ issueId, siteId: next === '' ? null : next });
  }

  const breadcrumb = (
    <div className="text-sm text-muted-foreground">
      <Link
        href={`/${locale}/observations`}
        className="hover:text-foreground hover:underline"
      >
        {t('breadcrumb')}
      </Link>
      <span className="mx-2">/</span>
      <span className="font-medium text-foreground">{issue.referenceNumber}</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/observations`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <header className="space-y-3">
        {breadcrumb}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
              {issue.referenceNumber}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">{issue.title}</h1>
            <StatusDropdown
              status={issue.status}
              canManage={canManage}
              onClose={() => setCloseOpen(true)}
              onReopen={() => reopen.mutate({ issueId })}
              tStatus={(k) => tStatus(k)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" disabled>
              <Share2 className="mr-1 h-4 w-4" />
              {t('actions.share')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="default">
                  <Plus className="mr-1 h-4 w-4" />
                  {t('actions.add')}
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>
                  <FileText className="mr-2 h-4 w-4" />
                  {t('actions.addInspection')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('actions.addAction')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('moreLabel')}>
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => archive.mutate({ issueId })}
                    disabled={archive.isPending}
                  >
                    <Archive className="mr-2 h-4 w-4" />
                    {t('archiveButton')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => archive.mutate({ issueId })}
                    disabled={archive.isPending}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('deleteButton')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </header>

      <nav className="border-b" aria-label={t('tabs.overview')}>
        <div className="flex gap-6">
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} label={t('tabs.overview')} />
          <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} label={t('tabs.activity')} />
          <TabButton active={tab === 'files'} onClick={() => setTab('files')} label={t('tabs.files')} />
          <TabButton
            active={tab === 'inspections'}
            onClick={() => setTab('inspections')}
            label={t('tabs.inspections')}
          />
          <TabButton active={tab === 'actions'} onClick={() => setTab('actions')} label={t('tabs.actions')} />
        </div>
      </nav>

      {tab === 'overview' ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold">{t('descriptionTitle')}</h2>
                  {canManage && !editingDescription ? (
                    <Button type="button" variant="ghost" size="sm" onClick={startEditDescription}>
                      <Pencil className="mr-1 h-4 w-4" />
                      {t('editButton')}
                    </Button>
                  ) : null}
                </div>
                {editingDescription ? (
                  <div className="space-y-2">
                    <Textarea
                      value={descriptionDraft}
                      onChange={(e) => setDescriptionDraft(e.target.value)}
                      rows={5}
                      maxLength={20_000}
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
              <CardContent className="space-y-4 p-6">
                <h2 className="text-base font-semibold">{t('detailsTitle')}</h2>
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t('fields.category')}>
                    <span className="inline-flex rounded-md bg-muted px-2 py-1 text-xs font-medium">
                      {issue.categorySnapshot.name}
                    </span>
                  </Field>
                  <Field label={t('fields.site')}>
                    {canManage ? (
                      <select
                        value={issue.siteId ?? ''}
                        onChange={(e) => updateSite(e.target.value)}
                        className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">—</option>
                        {(sites ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>{siteName}</span>
                    )}
                  </Field>
                  <Field label={t('fields.assignee')}>
                    <AssigneePicker
                      currentId={issue.assigneeUserId ?? null}
                      currentName={assignee?.name ?? null}
                      canManage={canManage}
                      onChange={updateAssignee}
                      tFields={t}
                    />
                  </Field>
                  <Field label={t('fields.priority')}>
                    {canManage ? (
                      <select
                        value={priority ?? ''}
                        onChange={(e) =>
                          updatePriority(
                            e.target.value === '' ? null : (e.target.value as Priority),
                          )
                        }
                        className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="">{t('fields.noPriority')}</option>
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {tPriority(p)}
                          </option>
                        ))}
                      </select>
                    ) : priority !== null ? (
                      <span className="inline-flex items-center gap-2">
                        <span className={cn('h-2 w-2 rounded-full', PRIORITY_DOT_CLASS[priority])} />
                        {tPriority(priority)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t('fields.noPriority')}</span>
                    )}
                  </Field>
                  <Field label={t('fields.dueDate')}>
                    {canManage ? (
                      <Input
                        type="datetime-local"
                        value={toLocalDatetime(issue.dueAt ?? null)}
                        onChange={(e) => updateDueAt(e.target.value)}
                      />
                    ) : issue.dueAt !== null && issue.dueAt !== undefined ? (
                      <span>{formatDate(issue.dueAt)}</span>
                    ) : (
                      <span className="text-muted-foreground">{t('fields.noDueDate')}</span>
                    )}
                  </Field>
                  <Field label={t('fields.dateOccurred')}>
                    {canManage ? (
                      <Input
                        type="datetime-local"
                        value={toLocalDatetime(issue.dateOccurred)}
                        onChange={(e) => updateDateOccurred(e.target.value)}
                      />
                    ) : (
                      <span>{formatDate(issue.dateOccurred)}</span>
                    )}
                  </Field>
                  <Field label={t('fields.reference')}>
                    <span className="font-mono text-xs">{issue.referenceNumber}</span>
                  </Field>
                  <Field label={t('fields.reportedVia')}>
                    <span>{tReportedVia(issue.reportedVia as 'app' | 'qr')}</span>
                  </Field>
                </dl>
              </CardContent>
            </Card>

            {data.categorySnapshot.customQuestions.length > 0 ? (
              <Card>
                <CardContent className="space-y-3 p-6 text-sm">
                  <h2 className="text-base font-semibold">{t('customQuestionsTitle')}</h2>
                  <dl className="space-y-2">
                    {data.categorySnapshot.customQuestions.map((q) => (
                      <div key={q.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[200px_1fr]">
                        <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                          {q.prompt}
                        </dt>
                        <dd>{formatValue(issue.customQuestionResponses[q.id])}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="text-base font-semibold">{t('metaReportedBy')}</h2>
                <p className="text-muted-foreground">
                  {issue.reportedByName ?? t('reportedAnonymous')}
                </p>
                <p className="text-xs text-muted-foreground">{formatDate(issue.createdAt)}</p>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="text-base font-semibold">{t('locationTitle')}</h2>
                {issue.locationAddress !== null && issue.locationAddress.length > 0 ? (
                  <p>{issue.locationAddress}</p>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
                {issue.locationGps !== null && issue.locationGps !== undefined ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    {issue.locationGps.lat.toFixed(5)}, {issue.locationGps.lng.toFixed(5)}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <AttachmentsCard issueId={issueId} canManage={canManage} compact />

            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="text-base font-semibold">{t('inspectionsTitle')}</h2>
                <p className="text-muted-foreground">{t('inspectionsEmpty')}</p>
              </CardContent>
            </Card>
          </aside>
        </div>
      ) : null}

      {tab === 'activity' ? <ActivityTimeline issueId={issueId} /> : null}

      {tab === 'files' ? <AttachmentsCard issueId={issueId} canManage={canManage} compact={false} /> : null}

      {tab === 'inspections' ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t('inspectionsEmpty')}
          </CardContent>
        </Card>
      ) : null}

      {tab === 'actions' ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {t('linkedActionsEmpty')}
          </CardContent>
        </Card>
      ) : null}

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
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-1 py-3 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function StatusDropdown({
  status,
  canManage,
  onClose,
  onReopen,
  tStatus,
}: {
  status: string;
  canManage: boolean;
  onClose: () => void;
  onReopen: () => void;
  tStatus: (k: 'open' | 'investigation' | 'closed') => string;
}) {
  type S = 'open' | 'investigation' | 'closed';
  const normalised: S =
    status === 'open' || status === 'investigation' || status === 'closed' ? status : 'open';
  const colors: Record<S, string> = {
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
    investigation: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
    closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  };
  const label = (
    <span className={cn('rounded-md px-2 py-0.5 text-xs font-medium', colors[normalised])}>
      {tStatus(normalised)}
    </span>
  );
  if (!canManage) return label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1">
          {label}
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {normalised !== 'closed' ? (
          <DropdownMenuItem onSelect={onClose}>{tStatus('closed')}</DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onReopen}>{tStatus('open')}</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { data: users } = trpc.users.list.useQuery({}, { enabled: open });
  const list = users?.users ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = needle === ''
    ? list
    : list.filter(
        (u) =>
          u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle),
      );

  if (!canManage) {
    return (
      <span>
        {currentName !== null && currentName.length > 0
          ? currentName
          : tFields('noAssignee')}
      </span>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="justify-start"
      >
        {currentName !== null && currentName.length > 0
          ? currentName
          : tFields('pickUser')}
      </Button>
      {currentId !== null ? (
        <button
          type="button"
          className="ml-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onChange(null)}
        >
          {tFields('clearAssignee')}
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tFields('pickUser')}</DialogTitle>
          </DialogHeader>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tFields('searchUsers')}
            aria-label={tFields('searchUsers')}
          />
          <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
            {filtered.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent/40"
                  onClick={() => {
                    onChange(u.id);
                    setOpen(false);
                  }}
                >
                  <span className="font-medium">{u.name}</span>
                  <span className="text-xs text-muted-foreground">{u.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActivityTimeline({ issueId }: { issueId: string }) {
  const t = useTranslations('issues.detail');
  const tEvents = useTranslations('issues.detail.activity.events');
  const tPriority = useTranslations('issues.priority');
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
            const actor = event.actorName ?? 'System';
            const initial = (actor[0] ?? '?').toUpperCase();
            const sentence = describeActivity(event, tEvents, tPriority);
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
                  <p className="text-xs text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function describeActivity(
  event: {
    kind: string;
    payload: Record<string, unknown>;
  },
  tEvents: (k: string, vars?: Record<string, string>) => string,
  tPriority: (k: 'low' | 'medium' | 'high' | 'critical') => string,
): string {
  const payload = event.payload;
  switch (event.kind) {
    case 'created':
      return tEvents('created');
    case 'status_changed':
      return tEvents('statusChanged', {
        from: String(payload.from ?? ''),
        to: String(payload.to ?? ''),
      });
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
      return tEvents('dueDateChanged', { to: new Date(to).toLocaleString() });
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

function AttachmentsCard({
  issueId,
  canManage,
  compact,
}: {
  issueId: string;
  canManage: boolean;
  compact: boolean;
}) {
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function uploadOne(file: File) {
    const form = new FormData();
    form.set('issueId', issueId);
    form.set('file', file);
    setUploading(true);
    try {
      const res = await fetch('/api/upload/observation-attachment', {
        method: 'POST',
        body: form,
      });
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
      <CardContent className={cn('space-y-3', compact ? 'p-6' : 'p-6')}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('filesTitle')}</h2>
        </div>
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
          <ul className={cn('grid gap-2', compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2')}>
            {rows.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-md border p-2 text-sm"
              >
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
                  <p className="text-xs text-muted-foreground">
                    {formatSize(a.sizeBytes)}
                  </p>
                </div>
                {canManage ? (
                  <button
                    type="button"
                    className="rounded-md p-1 text-muted-foreground hover:text-destructive"
                    aria-label={tAttachments('deleteAction')}
                    onClick={() => {
                      if (window.confirm(tAttachments('deleteConfirm'))) {
                        remove.mutate({ attachmentId: a.id });
                      }
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

function AttachmentThumb({
  mimeType,
  signedUrl,
}: {
  mimeType: string;
  signedUrl: string | null;
}) {
  if (mimeType.startsWith('image/') && signedUrl !== null) {
    return (
      <img
        src={signedUrl}
        alt=""
        className="h-10 w-10 flex-shrink-0 rounded object-cover"
      />
    );
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

function formatDate(d: Date | string | null | undefined): string {
  if (d === null || d === undefined) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString();
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

