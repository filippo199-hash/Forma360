'use client';

import { Archive, ArrowLeft, Pencil, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../src/components/ui/dropdown-menu';
import { Input } from '../../../../src/components/ui/input';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { cn } from '../../../../src/lib/cn';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type Tab = 'overview' | 'activity' | 'comments';
type Priority = 'low' | 'medium' | 'high' | 'critical';
type Status = 'open' | 'in_progress' | 'completed' | 'cancelled';

const PRIORITIES: ReadonlyArray<Priority> = ['low', 'medium', 'high', 'critical'];
const STATUSES: ReadonlyArray<Status> = ['open', 'in_progress', 'completed', 'cancelled'];

const STATUS_COLORS: Record<Status, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  cancelled: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

/**
 * Action detail page (Phase 4 build).
 *
 * Mirrors the observation detail layout: title + status pill + actions,
 * tabs across (Overview / Activity / Comments), then two columns —
 * inline-editable Description on the left + structured Details card
 * (status / priority / assignee / due / site / label / source link)
 * on the right. The Source row shows where the action came from
 * (inspection / observation / standalone) with a deep link.
 */
export default function ActionDetailPage() {
  const t = useTranslations('actions.detail');
  const tFields = useTranslations('actions.detail.fields');
  const tStatus = useTranslations('actions.status');
  const tPriority = useTranslations('actions.priority');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; actionId: string }>();
  const locale = params.locale ?? 'en';
  const actionId = params.actionId ?? '';
  const utils = trpc.useUtils();

  const canManage = useHasPermission('actions.manage');

  const [tab, setTab] = useState<Tab>('overview');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const { data, isLoading } = trpc.actions.get.useQuery({ actionId });
  const action = data?.action;
  const assignee = data?.assignee ?? null;
  const source = data?.source ?? null;
  const { data: sites } = trpc.sites.list.useQuery();

  const update = trpc.actions.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      void utils.actions.get.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const setStatus = trpc.actions.setStatus.useMutation({
    onSuccess: () => {
      toast.success(t('statusChangedToast'));
      void utils.actions.get.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const archive = trpc.actions.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.actions.get.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const restore = trpc.actions.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.actions.get.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (isLoading || action === undefined) {
    return <Skeleton className="m-6 h-96 w-full" />;
  }

  const overdue =
    action.dueAt !== null &&
    action.status !== 'completed' &&
    action.status !== 'cancelled' &&
    new Date(action.dueAt).getTime() < Date.now();

  // Archived actions are read-only by default — manager can restore
  // first if they want to edit. This mirrors how the observations
  // detail handles archived rows. `canEdit` is the flag every inline
  // editor on this page should gate on.
  const isArchived = action.archivedAt !== null;
  const canEdit = canManage && !isArchived;
  // Consistent reference fallback: use referenceNumber when present,
  // else the last 6 chars of the internal id (uppercased ULID tail).
  // The header pill, Details card, and observation Actions table all
  // call this so they never disagree.
  const refLabel = action.referenceNumber ?? action.id.slice(-6);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/actions`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{refLabel}</span>
            {editingTitle ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const next = titleDraft.trim();
                  if (next.length === 0 || next === action.title) {
                    setEditingTitle(false);
                    return;
                  }
                  update.mutate({ actionId, title: next });
                  setEditingTitle(false);
                }}
              >
                <Input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={500}
                  autoFocus
                  className="text-2xl font-semibold"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingTitle(false);
                  }}
                />
                <Button type="submit" size="sm" disabled={update.isPending}>
                  {t('actions.saveTitle')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditingTitle(false)}
                >
                  {t('actions.cancelTitle')}
                </Button>
              </form>
            ) : (
              <h1
                className={cn(
                  'text-2xl font-semibold tracking-tight',
                  canEdit ? 'cursor-text hover:underline' : '',
                )}
                onClick={() => {
                  if (!canEdit) return;
                  setTitleDraft(action.title);
                  setEditingTitle(true);
                }}
                title={canEdit ? t('actions.editTitleHint') : ''}
              >
                {action.title}
              </h1>
            )}
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isArchived}
                  >
                    <span
                      className={cn(
                        'rounded-md px-2 py-0.5 text-xs font-medium',
                        STATUS_COLORS[action.status as Status] ?? STATUS_COLORS.open,
                      )}
                    >
                      {tStatus(action.status as Status)}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {STATUSES.filter((s) => s !== action.status).map((s) => (
                    <DropdownMenuItem
                      key={s}
                      onSelect={() => setStatus.mutate({ actionId, status: s })}
                    >
                      {tStatus(s)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span
                className={cn(
                  'rounded-md px-2 py-0.5 text-xs font-medium',
                  STATUS_COLORS[action.status as Status] ?? STATUS_COLORS.open,
                )}
              >
                {tStatus(action.status as Status)}
              </span>
            )}
            {isArchived ? (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {t('archivedBadge')}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (typeof window === 'undefined') return;
                void navigator.clipboard
                  .writeText(window.location.href)
                  .then(() => toast.success(t('shareToast')))
                  .catch(() => toast.error(tCommon('error')));
              }}
            >
              <Share2 className="mr-1 h-4 w-4" />
              {t('actions.share')}
            </Button>
            {canManage ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  if (action.archivedAt === null) archive.mutate({ actionId });
                  else restore.mutate({ actionId });
                }}
                disabled={archive.isPending || restore.isPending}
              >
                <Archive className="mr-1 h-4 w-4" />
                {action.archivedAt === null ? t('actions.archive') : t('actions.restore')}
              </Button>
            ) : null}
          </div>
        </div>

        <nav className="flex gap-1 border-b">
          <TabButton
            active={tab === 'overview'}
            onClick={() => setTab('overview')}
            label={t('tabs.overview')}
          />
          <TabButton
            active={tab === 'activity'}
            onClick={() => setTab('activity')}
            label={t('tabs.activity')}
          />
          <TabButton
            active={tab === 'comments'}
            onClick={() => setTab('comments')}
            label={t('tabs.comments')}
          />
        </nav>
      </header>

      {tab === 'overview' ? (
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-3 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold">{t('descriptionTitle')}</h2>
                  {canEdit ? (
                    editingDescription ? null : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDescriptionDraft(action.description ?? '');
                          setEditingDescription(true);
                        }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        {t('actions.editDescription')}
                      </Button>
                    )
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
                        {t('actions.cancelDescription')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={update.isPending}
                        onClick={() => {
                          update.mutate({
                            actionId,
                            description:
                              descriptionDraft.trim().length === 0
                                ? null
                                : descriptionDraft.trim(),
                          });
                          setEditingDescription(false);
                        }}
                      >
                        {t('actions.saveDescription')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className={action.description !== null && action.description.length > 0 ? '' : 'text-muted-foreground'}>
                    {action.description ?? t('descriptionEmpty')}
                  </p>
                )}
              </CardContent>
            </Card>

            <SourceCard source={source} sourceId={action.sourceId} locale={locale} />
          </div>

          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="text-base font-semibold">{t('detailsTitle')}</h2>
              <DetailRow label={tFields('reference')}>
                <span className="font-mono text-xs">{refLabel}</span>
              </DetailRow>
              <DetailRow label={tFields('priority')}>
                {canEdit ? (
                  <select
                    value={action.priority ?? ''}
                    onChange={(e) =>
                      update.mutate({
                        actionId,
                        priority:
                          e.target.value === ''
                            ? null
                            : (e.target.value as Priority),
                      })
                    }
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="">{tFields('noPriority')}</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {tPriority(p)}
                      </option>
                    ))}
                  </select>
                ) : action.priority !== null &&
                  (action.priority === 'low' ||
                    action.priority === 'medium' ||
                    action.priority === 'high' ||
                    action.priority === 'critical') ? (
                  tPriority(action.priority)
                ) : (
                  tFields('noPriority')
                )}
              </DetailRow>
              <DetailRow label={tFields('assignee')}>
                <AssigneePicker
                  currentId={action.assigneeUserId}
                  currentName={assignee?.name ?? null}
                  canManage={canEdit}
                  onChange={(next) => update.mutate({ actionId, assigneeUserId: next })}
                  tFields={tFields}
                />
              </DetailRow>
              <DetailRow label={tFields('dueDate')}>
                {canEdit ? (
                  <Input
                    type="datetime-local"
                    value={toLocalDatetime(action.dueAt)}
                    onChange={(e) =>
                      update.mutate({
                        actionId,
                        dueAt:
                          e.target.value === ''
                            ? null
                            : new Date(e.target.value).toISOString(),
                      })
                    }
                    className={overdue ? 'border-destructive text-destructive' : ''}
                  />
                ) : action.dueAt !== null ? (
                  new Date(action.dueAt).toLocaleString()
                ) : (
                  tFields('noDueDate')
                )}
              </DetailRow>
              <DetailRow label={tFields('site')}>
                {canEdit ? (
                  <select
                    value={action.siteId ?? ''}
                    onChange={(e) =>
                      update.mutate({
                        actionId,
                        siteId: e.target.value === '' ? null : e.target.value,
                      })
                    }
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="">{tFields('noSite')}</option>
                    {(sites ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                ) : action.siteId !== null ? (
                  (sites ?? []).find((s) => s.id === action.siteId)?.name ?? '—'
                ) : (
                  tFields('noSite')
                )}
              </DetailRow>
              <DetailRow label={tFields('label')}>
                {canEdit ? (
                  <LabelInput
                    initial={action.label ?? ''}
                    onCommit={(next) =>
                      update.mutate({
                        actionId,
                        label: next.length === 0 ? null : next,
                      })
                    }
                  />
                ) : action.label !== null && action.label.length > 0 ? (
                  action.label
                ) : (
                  tFields('noLabel')
                )}
              </DetailRow>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {tab === 'activity' ? (
        <ActivityTimeline
          actionId={actionId}
          createdAt={action.createdAt}
          createdByName={data?.creatorName ?? null}
        />
      ) : null}

      {tab === 'comments' ? (
        <CommentsThread actionId={actionId} readOnly={isArchived} />
      ) : null}
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
        'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        active
          ? 'border-foreground text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[110px_1fr]">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

/**
 * Label edits commit on blur so we don't fire a mutation per keystroke;
 * the local state keeps the field responsive while typing.
 */
function LabelInput({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (next: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const lastCommit = useRef(initial);
  useEffect(() => {
    setValue(initial);
    lastCommit.current = initial;
  }, [initial]);
  return (
    <Input
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const next = value.trim();
        if (next !== lastCommit.current) {
          lastCommit.current = next;
          onCommit(next);
        }
      }}
    />
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
  const { data: usersData } = trpc.users.list.useQuery({});
  const users = usersData?.users ?? [];
  if (!canManage) {
    return (
      <span>{currentName !== null && currentName.length > 0 ? currentName : tFields('noAssignee')}</span>
    );
  }
  return (
    <select
      value={currentId ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
    >
      <option value="">{tFields('noAssignee')}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </select>
  );
}

function SourceCard({
  source,
  sourceId,
  locale,
}: {
  source: {
    type: 'issue' | 'inspection' | 'standalone';
    referenceNumber: string | null;
    title: string | null;
  } | null;
  sourceId: string | null;
  locale: string;
}) {
  const t = useTranslations('actions.detail');
  if (source === null || source.type === 'standalone' || sourceId === null) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {t('sourceLinkStandalone')}
        </CardContent>
      </Card>
    );
  }
  const href =
    source.type === 'issue'
      ? `/${locale}/observations/${sourceId}`
      : `/${locale}/inspections/${sourceId}`;
  // Prefer the real reference (ISS-000002 / INS-...). Fall back to the
  // last 6 chars of the internal id only when the source has been deleted
  // or no reference was ever assigned. The title (when present) goes on
  // a second line so the row is scannable without sacrificing detail.
  const reference = source.referenceNumber ?? sourceId.slice(-6);
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-2 p-6 text-sm">
        <div className="space-y-0.5">
          <p>
            {source.type === 'issue'
              ? t('sourceLinkIssue', { referenceNumber: reference })
              : t('sourceLinkInspection', { referenceNumber: reference })}
          </p>
          {source.title !== null && source.title.length > 0 ? (
            <p className="text-muted-foreground">{source.title}</p>
          ) : null}
        </div>
        <Button asChild type="button" variant="outline" size="sm">
          <Link href={href}>{t('sourceLinkOpen')}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function ActivityTimeline({
  actionId,
  createdAt,
  createdByName,
}: {
  actionId: string;
  createdAt: Date | string;
  createdByName: string | null;
}) {
  const tEvents = useTranslations('actions.detail.activity.events');
  const tStatus = useTranslations('actions.status');
  const tPriority = useTranslations('actions.priority');
  const { data, isLoading } = trpc.actions.activity.list.useQuery({ actionId });
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  const rows = data ?? [];
  // Pre-migration actions (created before action_activity existed)
  // don't have a `created` row in the log. Synthesise one from
  // `action.createdAt` + `action.createdBy` so the timeline always
  // has at least one entry. The synthetic row uses `'created-synth'`
  // as its id to avoid colliding with real activity ids.
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 p-6 text-sm">
          <div className="flex items-start gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
              {(createdByName ?? '?').slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p>
                <span className="font-medium">{createdByName ?? '—'}</span>{' '}
                <span className="text-muted-foreground">{tEvents('created')}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="space-y-3 p-6 text-sm">
        {rows.map((row) => {
          const payload = (row.payload ?? {}) as Record<string, unknown>;
          let text = '';
          if (row.kind === 'priority_changed') {
            const to = String(payload['to'] ?? '');
            text = tEvents('priority_changed', {
              to:
                to === 'low' || to === 'medium' || to === 'high' || to === 'critical'
                  ? tPriority(to)
                  : to,
            });
          } else if (row.kind === 'status_changed') {
            const from = String(payload['from'] ?? '');
            const to = String(payload['to'] ?? '');
            const statusLabel = (s: string): string => {
              if (s === 'open' || s === 'in_progress' || s === 'completed' || s === 'cancelled') {
                return tStatus(s);
              }
              return s;
            };
            text = tEvents('status_changed', { from: statusLabel(from), to: statusLabel(to) });
          } else if (row.kind === 'due_date_changed') {
            const to = String(payload['to'] ?? '');
            text = tEvents('due_date_changed', { to: new Date(to).toLocaleString() });
          } else if (row.kind === 'assignee_changed') {
            text = tEvents('assignee_changed', { to: String(payload['to'] ?? '') });
          } else if (row.kind === 'site_changed') {
            text = tEvents('site_changed', { to: String(payload['to'] ?? '') });
          } else if (row.kind === 'label_changed') {
            text = tEvents('label_changed', { to: String(payload['to'] ?? '') });
          } else if (
            row.kind === 'created' ||
            row.kind === 'assignee_cleared' ||
            row.kind === 'due_date_cleared' ||
            row.kind === 'site_cleared' ||
            row.kind === 'commented' ||
            row.kind === 'title_changed' ||
            row.kind === 'description_changed' ||
            row.kind === 'archived' ||
            row.kind === 'restored'
          ) {
            text = tEvents(row.kind);
          } else {
            text = row.kind;
          }
          return (
            <div key={row.id} className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {(row.actorName ?? '?').slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p>
                  <span className="font-medium">{row.actorName ?? '—'}</span>{' '}
                  <span className="text-muted-foreground">{text}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function CommentsThread({
  actionId,
  readOnly,
}: {
  actionId: string;
  readOnly: boolean;
}) {
  const t = useTranslations('actions.detail.comments');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const [body, setBody] = useState('');
  const { data, isLoading } = trpc.actions.comments.list.useQuery({ actionId });
  const create = trpc.actions.comments.create.useMutation({
    onSuccess: () => {
      toast.success(t('createdToast'));
      setBody('');
      void utils.actions.comments.list.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });
  const remove = trpc.actions.comments.delete.useMutation({
    onSuccess: () => {
      toast.success(t('deletedToast'));
      void utils.actions.comments.list.invalidate({ actionId });
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <div className="space-y-4">
      {readOnly ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {t('archivedNotice')}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-6">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('placeholder')}
              rows={3}
              maxLength={20_000}
            />
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={body.trim().length === 0 || create.isPending}
                onClick={() => create.mutate({ actionId, body: body.trim() })}
              >
                {t('submit')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        (data ?? []).map((c) => (
          <Card key={c.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">{c.authorName ?? '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString()}
                </p>
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (typeof window !== 'undefined' && !window.confirm(t('deleteConfirm'))) {
                      return;
                    }
                    remove.mutate({ commentId: c.id });
                  }}
                  disabled={remove.isPending}
                >
                  {t('delete')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function toLocalDatetime(d: Date | string | null | undefined): string {
  if (d === null || d === undefined) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
