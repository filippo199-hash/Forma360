'use client';

/**
 * ActionDetailPanel — full action detail rendered inside the sidebar Sheet.
 *
 * Accepts `actionId` + `locale` as props so it can be used both from the
 * kanban slide-over and (potentially) other surfaces, without the caller
 * needing to know the internal data shape.
 *
 * All sub-components are co-located here so this file is self-contained
 * and the full-page route (`[actionId]/page.tsx`) doesn't need to change.
 */

import type { ActionCustomQuestion } from '@forma360/shared/actions-schema';
import { Archive, ExternalLink, Pencil, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { SiteSelector } from '../selectors/site-selector';
import { usePlaceTerms } from '../../lib/terminology';
import { GroupUserSelector } from '../selectors/group-user-selector';
import { AssetField } from './asset-field';
import { DetailNotFound } from '../detail-not-found';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { Textarea } from '../ui/textarea';
import { cn } from '../../lib/cn';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'activity' | 'comments';
type Priority = 'low' | 'medium' | 'high' | 'critical';
type Status = 'open' | 'in_progress' | 'completed' | 'cancelled';

interface RecurrenceCardValue {
  rrule: string;
  endDate: string | null;
}

const PRIORITIES: ReadonlyArray<Priority> = ['low', 'medium', 'high', 'critical'];
const STATUSES: ReadonlyArray<Status> = ['open', 'in_progress', 'completed', 'cancelled'];

const STATUS_COLORS: Record<Status, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  cancelled: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

// ── Main panel ────────────────────────────────────────────────────────────────

export function ActionDetailPanel({ actionId, locale }: { actionId: string; locale: string }) {
  const t = useTranslations('actions.detail');
  const tFields = useTranslations('actions.detail.fields');
  const { label: placeLabel, noneLabel: placeNone } = usePlaceTerms();
  const tStatus = useTranslations('actions.status');
  const tPriority = useTranslations('actions.priority');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const canManage = useHasPermission('actions.manage');

  const [tab, setTab] = useState<Tab>('overview');
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const { data, isLoading, error } = trpc.actions.get.useQuery({ actionId });
  const action = data?.action;
  const actionType = data?.actionType ?? null;
  const assignee = data?.assignee ?? null;
  const source = data?.source ?? null;
  const linkedAssets = data?.assets ?? [];
  const { data: sites } = trpc.sites.list.useQuery();

  const update = trpc.actions.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      void utils.actions.get.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
      void utils.actions.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const setStatus = trpc.actions.setStatus.useMutation({
    onSuccess: () => {
      toast.success(t('statusChangedToast'));
      void utils.actions.get.invalidate({ actionId });
      void utils.actions.activity.list.invalidate({ actionId });
      void utils.actions.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const archive = trpc.actions.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.actions.get.invalidate({ actionId });
      void utils.actions.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const restore = trpc.actions.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.actions.get.invalidate({ actionId });
      void utils.actions.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (isLoading || action === undefined) {
    // On a settled error `action` stays undefined — show a recoverable
    // error/not-found state instead of skeletoning forever.
    if (error !== null && error !== undefined) {
      return (
        <div className="p-6">
          <DetailNotFound error={error} />
        </div>
      );
    }
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const overdue =
    action.dueAt !== null &&
    action.status !== 'completed' &&
    action.status !== 'cancelled' &&
    new Date(action.dueAt).getTime() < Date.now();

  const isArchived = action.archivedAt !== null;
  const canEdit = canManage && !isArchived;
  const isAuto = action.sourceType === 'maintenance';
  const refLabel = action.referenceNumber ?? action.id.slice(-6);

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="shrink-0 border-b px-6 py-4">
        {/* Ref + badges row */}
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{refLabel}</span>

          {/* Status pill — clickable dropdown for managers */}
          {canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="disabled:cursor-not-allowed disabled:opacity-50"
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

          {actionType !== null ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">
              {actionType.color !== null && actionType.color.length > 0 ? (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: actionType.color }}
                  aria-hidden="true"
                />
              ) : null}
              {actionType.name}
            </span>
          ) : null}

          {isArchived ? (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {t('archivedBadge')}
            </span>
          ) : null}

          {isAuto ? (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-100"
              title={
                source?.title !== null && source?.title !== undefined
                  ? t('autoGeneratedBy', { program: source.title })
                  : t('autoGeneratedBadge')
              }
            >
              <Wrench className="h-3 w-3" aria-hidden="true" />
              {t('autoGeneratedBadge')}
            </span>
          ) : null}
        </div>

        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          {editingTitle ? (
            <form
              className="flex flex-1 items-center gap-2"
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
                className="text-lg font-semibold"
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
            <h2
              className={cn(
                'flex-1 text-lg font-semibold leading-snug tracking-tight',
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
            </h2>
          )}

          {/* Action buttons — open full page + archive */}
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/${locale}/actions/${actionId}`} target="_blank">
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="sr-only">{t('backLink')}</span>
              </Link>
            </Button>
            {canManage ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (action.archivedAt === null) archive.mutate({ actionId });
                  else restore.mutate({ actionId });
                }}
                disabled={archive.isPending || restore.isPending}
              >
                <Archive className="h-3.5 w-3.5" />
                <span className="sr-only">
                  {action.archivedAt === null ? t('actions.archive') : t('actions.restore')}
                </span>
              </Button>
            ) : null}
          </div>
        </div>

        {/* Tabs */}
        <nav className="mt-3 flex gap-1 border-b">
          {(['overview', 'activity', 'comments'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === key
                  ? 'border-foreground text-foreground font-semibold'
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
          <div className="p-6">
            <Card>
              <CardContent className="p-0">
                {/* Description */}
                <section className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{t('descriptionTitle')}</h3>
                    {canEdit && !editingDescription ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDescriptionDraft(action.description ?? '');
                          setEditingDescription(true);
                        }}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        {t('actions.editDescription')}
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
                    <p
                      className={
                        action.description !== null && action.description.length > 0
                          ? 'text-sm'
                          : 'text-sm text-muted-foreground'
                      }
                    >
                      {action.description ?? t('descriptionEmpty')}
                    </p>
                  )}
                </section>

                {/* Details */}
                <section className="space-y-3 border-t p-5 text-sm">
                  <h3 className="font-semibold">{t('detailsTitle')}</h3>

                  <DetailRow label={tFields('status')}>
                    {canManage && !isArchived ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="w-full text-left">
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
                  </DetailRow>

                  <DetailRow label={tFields('priority')}>
                    {canEdit ? (
                      <select
                        value={action.priority ?? ''}
                        onChange={(e) =>
                          update.mutate({
                            actionId,
                            priority: e.target.value === '' ? null : (e.target.value as Priority),
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
                              e.target.value === '' ? null : new Date(e.target.value).toISOString(),
                          })
                        }
                        className={overdue ? 'border-destructive text-destructive' : ''}
                      />
                    ) : action.dueAt !== null ? (
                      new Date(action.dueAt).toLocaleString(locale)
                    ) : (
                      tFields('noDueDate')
                    )}
                  </DetailRow>

                  <DetailRow label={placeLabel}>
                    {canEdit ? (
                      <SiteSelector
                        value={action.siteId !== null ? [action.siteId] : []}
                        onChange={(next) => update.mutate({ actionId, siteId: next[0] ?? null })}
                        multiple={false}
                        placeholder={placeNone}
                      />
                    ) : action.siteId !== null ? (
                      ((sites ?? []).find((s) => s.id === action.siteId)?.name ?? '—')
                    ) : (
                      placeNone
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

                  <DetailRow label={tFields('asset')}>
                    <AssetField
                      linked={linkedAssets}
                      canEdit={canEdit}
                      locale={locale}
                      onChange={(next) => update.mutate({ actionId, assetIds: next })}
                    />
                  </DetailRow>
                </section>

                {/* Source */}
                <SourceCard source={source} sourceId={action.sourceId} locale={locale} />

                {/* Custom questions */}
                {actionType !== null ? (
                  <CustomQuestionsCard
                    actionId={actionId}
                    actionType={actionType}
                    responses={(action.customQuestionResponses ?? {}) as Record<string, unknown>}
                    canEdit={canEdit}
                  />
                ) : null}

                {/* Recurrence */}
                <RecurrenceCard
                  actionId={actionId}
                  recurrence={action.recurrence as RecurrenceCardValue}
                  canEdit={canEdit}
                />
              </CardContent>
            </Card>
          </div>
        ) : null}

        {tab === 'activity' ? (
          <div className="p-6">
            <ActivityTimeline
              actionId={actionId}
              createdAt={action.createdAt}
              createdByName={data?.creatorName ?? null}
              locale={locale}
            />
          </div>
        ) : null}

        {tab === 'comments' ? (
          <div className="p-6">
            <CommentsThread actionId={actionId} readOnly={isArchived} locale={locale} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Sub-components (mirrored from [actionId]/page.tsx) ────────────────────────

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2 py-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function LabelInput({ initial, onCommit }: { initial: string; onCommit: (next: string) => void }) {
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
  if (!canManage) {
    return (
      <span>
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
      placeholder={tFields('noAssignee')}
    />
  );
}

function SourceCard({
  source,
  sourceId,
  locale,
}: {
  source: {
    type: 'issue' | 'inspection' | 'standalone' | 'maintenance' | 'incident';
    referenceNumber: string | null;
    title: string | null;
  } | null;
  sourceId: string | null;
  locale: string;
}) {
  const t = useTranslations('actions.detail');
  // Maintenance-sourced actions surface their origin via the auto-generated
  // badge + the Asset row instead of this generic source card.
  if (
    source === null ||
    source.type === 'standalone' ||
    source.type === 'maintenance' ||
    sourceId === null
  )
    return null;
  const href =
    source.type === 'issue'
      ? `/${locale}/observations/${sourceId}`
      : source.type === 'incident'
        ? `/${locale}/incidents/${sourceId}`
        : `/${locale}/inspections/${sourceId}`;
  const reference = source.referenceNumber ?? sourceId.slice(-6);
  return (
    <section className="flex items-start justify-between gap-2 border-t p-5 text-sm">
      <p>
        {source.type === 'issue'
          ? t('sourceLinkIssue', { referenceNumber: reference })
          : source.type === 'incident'
            ? t('sourceLinkIncident', { referenceNumber: reference })
            : t('sourceLinkInspection', { referenceNumber: reference })}
      </p>
      <Button asChild type="button" variant="outline" size="sm">
        <Link href={href} target="_blank">
          {t('sourceLinkOpen')}
        </Link>
      </Button>
    </section>
  );
}

function ActivityTimeline({
  actionId,
  createdAt,
  createdByName,
  locale,
}: {
  actionId: string;
  createdAt: Date | string;
  createdByName: string | null;
  locale: string;
}) {
  const tEvents = useTranslations('actions.detail.activity.events');
  const tStatus = useTranslations('actions.status');
  const tPriority = useTranslations('actions.priority');
  const { data, isLoading } = trpc.actions.activity.list.useQuery({ actionId });
  // Resolve the raw user/site ids stored in assignee/site-change payloads to
  // names so the feed doesn't print 26-char ULIDs.
  const { data: usersData } = trpc.users.list.useQuery({});
  const { data: sitesData } = trpc.sites.list.useQuery();
  const userName = (id: string): string => usersData?.users.find((u) => u.id === id)?.name ?? id;
  const siteName = (id: string): string => sitesData?.find((s) => s.id === id)?.name ?? id;

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
          {(createdByName ?? '?').slice(0, 1).toUpperCase()}
        </div>
        <div>
          <p className="text-sm">
            <span className="font-medium">{createdByName ?? '—'}</span>{' '}
            <span className="text-muted-foreground">{tEvents('created')}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(createdAt).toLocaleString(locale)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
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
          text = tEvents('due_date_changed', { to: new Date(to).toLocaleString(locale) });
        } else if (row.kind === 'assignee_changed') {
          text = tEvents('assignee_changed', { to: userName(String(payload['to'] ?? '')) });
        } else if (row.kind === 'site_changed') {
          text = tEvents('site_changed', { to: siteName(String(payload['to'] ?? '')) });
        } else if (row.kind === 'label_changed') {
          text = tEvents('label_changed', { to: String(payload['to'] ?? '') });
        } else if (row.kind === 'created' && payload['auto'] === true) {
          const program =
            typeof payload['programName'] === 'string' && payload['programName'].length > 0
              ? payload['programName']
              : null;
          text =
            program !== null
              ? tEvents('created_auto', { program })
              : tEvents('created_auto_generic');
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
              <p className="text-sm">
                <span className="font-medium">{row.actorName ?? '—'}</span>{' '}
                <span className="text-muted-foreground">{text}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleString(locale)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CommentsThread({
  actionId,
  readOnly,
  locale,
}: {
  actionId: string;
  readOnly: boolean;
  locale: string;
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
        <p className="text-sm text-muted-foreground">{t('archivedNotice')}</p>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-5">
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
                  {new Date(c.createdAt).toLocaleString(locale)}
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalDatetime(d: Date | string | null | undefined): string {
  if (d === null || d === undefined) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function parseFreq(
  rrule: string | null | undefined,
): 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY' | null {
  if (rrule === null || rrule === undefined) return null;
  const m = /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.exec(rrule);
  if (m === null) return null;
  return m[1] as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
}

function parseInterval(rrule: string | null | undefined): number | null {
  if (rrule === null || rrule === undefined) return null;
  const m = /INTERVAL=(\d+)/.exec(rrule);
  return m !== null ? parseInt(m[1] ?? '', 10) : null;
}

interface ActionTypeShape {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  customQuestions: ReadonlyArray<ActionCustomQuestion>;
}

function CustomQuestionsCard({
  actionId,
  actionType,
  responses,
  canEdit,
}: {
  actionId: string;
  actionType: ActionTypeShape;
  responses: Record<string, unknown>;
  canEdit: boolean;
}) {
  const t = useTranslations('actions.detail.customQuestions');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>(responses);

  useEffect(() => {
    setDraft(responses);
  }, [responses]);

  const update = trpc.actions.update.useMutation({
    onSuccess: () => {
      toast.success(t('savedToast'));
      void utils.actions.get.invalidate({ actionId });
      setEditing(false);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (actionType.customQuestions.length === 0) return null;

  return (
    <section className="space-y-3 border-t p-5 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t('title')}</h3>
        {canEdit && !editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {tCommon('edit')}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="space-y-3">
          {actionType.customQuestions.map((q) => (
            <div key={q.id} className="space-y-1.5">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                {q.prompt}
                {q.required ? <span className="ml-1 text-destructive">*</span> : null}
              </label>
              {q.type === 'text' ? (
                <Textarea
                  value={typeof draft[q.id] === 'string' ? (draft[q.id] as string) : ''}
                  onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })}
                  rows={2}
                  maxLength={2000}
                />
              ) : q.type === 'number' ? (
                <Input
                  type="number"
                  value={
                    typeof draft[q.id] === 'number'
                      ? String(draft[q.id])
                      : typeof draft[q.id] === 'string'
                        ? (draft[q.id] as string)
                        : ''
                  }
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      [q.id]: e.target.value === '' ? '' : Number(e.target.value),
                    })
                  }
                />
              ) : (
                <select
                  value={typeof draft[q.id] === 'string' ? (draft[q.id] as string) : ''}
                  onChange={(e) => setDraft({ ...draft, [q.id]: e.target.value })}
                  className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                >
                  <option value="" />
                  {q.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setDraft(responses);
              }}
            >
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={update.isPending}
              onClick={() => update.mutate({ actionId, customQuestionResponses: draft })}
            >
              {tCommon('save')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {actionType.customQuestions.map((q) => (
            <div key={q.id}>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{q.prompt}</p>
              <p className="mt-0.5">{String(responses[q.id] ?? '—')}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RecurrenceCard({
  actionId,
  recurrence,
  canEdit,
}: {
  actionId: string;
  recurrence: RecurrenceCardValue | null | undefined;
  canEdit: boolean;
}) {
  const t = useTranslations('actions.detail.recurrence');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const initial = recurrence ?? null;
  const [enabled, setEnabled] = useState(initial !== null);
  const [freq, setFreq] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'>(
    parseFreq(initial?.rrule) ?? 'WEEKLY',
  );
  const [interval, setInterval] = useState<number>(parseInterval(initial?.rrule) ?? 1);
  const [endDate, setEndDate] = useState<string>(
    initial?.endDate !== null && initial?.endDate !== undefined ? initial.endDate.slice(0, 10) : '',
  );

  useEffect(() => {
    setEnabled(initial !== null);
    setFreq(parseFreq(initial?.rrule) ?? 'WEEKLY');
    setInterval(parseInterval(initial?.rrule) ?? 1);
    setEndDate(
      initial?.endDate !== null && initial?.endDate !== undefined
        ? initial.endDate.slice(0, 10)
        : '',
    );
  }, [initial?.rrule, initial?.endDate]);

  const update = trpc.actions.update.useMutation({
    onSuccess: () => {
      toast.success(t('savedToast'));
      void utils.actions.get.invalidate({ actionId });
      setEditing(false);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  if (!canEdit && initial === null) return null;

  return (
    <section className="space-y-3 border-t p-5 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{t('title')}</h3>
        {canEdit && !editing ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {tCommon('edit')}
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="space-y-3">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded"
            />
            <span>{t('enableLabel')}</span>
          </label>
          {enabled ? (
            <>
              <div className="flex items-center gap-2">
                <span>{t('everyLabel')}</span>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={interval}
                  onChange={(e) => setInterval(parseInt(e.target.value, 10) || 1)}
                  className="w-16"
                />
                <select
                  value={freq}
                  onChange={(e) => setFreq(e.target.value as typeof freq)}
                  className="rounded-md border border-input bg-background px-2 py-1"
                >
                  {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).map((f) => (
                    <option key={f} value={f}>
                      {t(`freq.${f.toLowerCase()}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span>{t('endDateLabel')}</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-auto"
                />
              </div>
            </>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              {tCommon('cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={update.isPending}
              onClick={() => {
                if (!enabled) {
                  update.mutate({ actionId, recurrence: null });
                  return;
                }
                const rrule = `FREQ=${freq};INTERVAL=${Math.max(1, Math.min(99, interval))}`;
                update.mutate({
                  actionId,
                  recurrence: {
                    rrule,
                    endDate: endDate === '' ? null : new Date(`${endDate}T23:59:59Z`).toISOString(),
                  },
                });
              }}
            >
              {tCommon('save')}
            </Button>
          </div>
        </div>
      ) : initial !== null ? (
        <p className="text-muted-foreground">
          {t('summary', {
            freq: t(`freq.${(parseFreq(initial.rrule) ?? 'weekly').toLowerCase()}`),
            interval: String(parseInterval(initial.rrule) ?? 1),
          })}
        </p>
      ) : (
        <p className="text-muted-foreground">{t('noRecurrence')}</p>
      )}
    </section>
  );
}
