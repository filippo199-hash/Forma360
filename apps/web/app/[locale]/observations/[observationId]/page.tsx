'use client';

import { Archive, ArrowLeft, MoreHorizontal, Pencil, Reply, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Observation detail view. Two-column on desktop: details + comments on
 * the left, action sidebar on the right. Mutations are gated by
 * `issues.manage`; the UI hides them when the viewer doesn't have it
 * (the server is the source of truth). The route segment is
 * `[observationId]` but the tRPC layer still uses the `issueId` argument
 * name — backend rename is intentionally deferred.
 */
export default function ObservationDetailPage() {
  const t = useTranslations('issues.detail');
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
  const { data: comments } = trpc.issues.comments.list.useQuery(
    { issueId },
    { enabled: issueId.length > 0 },
  );

  const [editOpen, setEditOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);

  const reopen = trpc.issues.issues.reopen.useMutation({
    onSuccess: () => {
      toast.success(t('reopenToast'));
      void utils.issues.issues.get.invalidate({ issueId });
    },
    onError: () => toast.error(tCommon('error')),
  });

  const archive = trpc.issues.issues.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      router.push(`/${locale}/observations`);
    },
    onError: () => toast.error(tCommon('error')),
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
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{issue.title}</h1>
          <ObservationStatusBadge status={issue.status} />
          <span className="font-mono text-xs text-muted-foreground">{issue.referenceNumber}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <DetailRow label={t('metaCategory')} value={issue.categorySnapshot.name} />
              <DetailRow label={t('metaSite')} value={siteName} />
              <DetailRow
                label={t('metaReportedBy')}
                value={issue.reportedByName ?? t('reportedAnonymous')}
              />
              <DetailRow label={t('metaReportedVia')} value={issue.reportedVia} />
              <DetailRow label={t('metaDateOccurred')} value={formatDate(issue.dateOccurred)} />
              <DetailRow label={t('metaCreated')} value={formatDate(issue.createdAt)} />
              {issue.locationAddress !== null && issue.locationAddress.length > 0 ? (
                <DetailRow label={t('metaLocation')} value={issue.locationAddress} />
              ) : null}
              {issue.status === 'closed' && issue.closedReason !== null ? (
                <DetailRow label={t('metaClosedReason')} value={issue.closedReason} />
              ) : null}
            </CardContent>
          </Card>

          {issue.description !== null && issue.description.length > 0 ? (
            <Card>
              <CardContent className="space-y-2 p-6">
                <h2 className="text-sm font-medium">{t('descriptionTitle')}</h2>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {issue.description}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {data.categorySnapshot.customFields.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <h2 className="font-medium">{t('customFieldsTitle')}</h2>
                {data.categorySnapshot.customFields.map((f) => (
                  <DetailRow
                    key={f.id}
                    label={f.label}
                    value={formatValue(issue.customFieldValues[f.id])}
                  />
                ))}
              </CardContent>
            </Card>
          ) : null}

          {data.categorySnapshot.customQuestions.length > 0 ? (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <h2 className="font-medium">{t('customQuestionsTitle')}</h2>
                {data.categorySnapshot.customQuestions.map((q) => (
                  <DetailRow
                    key={q.id}
                    label={q.prompt}
                    value={formatValue(issue.customQuestionResponses[q.id])}
                  />
                ))}
              </CardContent>
            </Card>
          ) : null}

          <CommentsSection issueId={issueId} comments={comments ?? []} canManage={canManage} />
        </div>

        <aside className="space-y-4">
          <Card>
            <CardContent className="space-y-3 p-4">
              <h2 className="text-sm font-medium">{t('actionsTitle')}</h2>
              {canManage ? (
                <>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {t('editButton')}
                  </Button>
                  {issue.status !== 'closed' ? (
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => setCloseOpen(true)}
                    >
                      <X className="mr-2 h-4 w-4" />
                      {t('closeButton')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => reopen.mutate({ issueId })}
                      disabled={reopen.isPending}
                    >
                      <Reply className="mr-2 h-4 w-4" />
                      {t('reopenButton')}
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="w-full justify-start">
                        <MoreHorizontal className="mr-2 h-4 w-4" />
                        {t('moreLabel')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => archive.mutate({ issueId })}
                        disabled={archive.isPending}
                      >
                        <Archive className="mr-2 h-4 w-4" />
                        {t('archiveButton')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">{t('actionsLocked')}</p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {editOpen ? (
        <EditObservationDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          issueId={issueId}
          initialTitle={issue.title}
          initialDescription={issue.description ?? ''}
          initialSiteId={issue.siteId ?? ''}
          initialDateOccurred={toLocalDatetime(issue.dateOccurred)}
          sites={sites ?? []}
        />
      ) : null}

      {closeOpen ? (
        <CloseObservationDialog
          open={closeOpen}
          onOpenChange={setCloseOpen}
          issueId={issueId}
        />
      ) : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="min-w-32 text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="break-words">{value}</span>
    </div>
  );
}

function ObservationStatusBadge({ status }: { status: string }) {
  const t = useTranslations('issues.status');
  type Status = 'open' | 'investigation' | 'closed';
  const normalised: Status =
    status === 'open' || status === 'investigation' || status === 'closed'
      ? (status as Status)
      : 'open';
  const colors: Record<Status, string> = {
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
    investigation: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
    closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[normalised]}`}>
      {t(normalised)}
    </span>
  );
}

function CommentsSection({
  issueId,
  comments,
  canManage,
}: {
  issueId: string;
  comments: ReadonlyArray<{
    id: string;
    authorUserId: string;
    body: string;
    createdAt: Date | string;
    updatedAt: Date | string;
  }>;
  canManage: boolean;
}) {
  const t = useTranslations('issues.detail');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const [body, setBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

  const create = trpc.issues.comments.create.useMutation({
    onSuccess: () => {
      setBody('');
      void utils.issues.comments.list.invalidate({ issueId });
    },
    onError: () => toast.error(tCommon('error')),
  });

  const update = trpc.issues.comments.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      setEditingBody('');
      void utils.issues.comments.list.invalidate({ issueId });
    },
    onError: () => toast.error(tCommon('error')),
  });

  const remove = trpc.issues.comments.delete.useMutation({
    onSuccess: () => {
      void utils.issues.comments.list.invalidate({ issueId });
    },
    onError: () => toast.error(tCommon('error')),
  });

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-sm font-medium">{t('commentsTitle')}</h2>
        <ul className="space-y-3">
          {comments.length === 0 ? (
            <li className="text-sm text-muted-foreground">{t('commentsEmpty')}</li>
          ) : (
            comments.map((c) => (
              <li key={c.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{formatDate(c.createdAt)}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="hover:text-foreground"
                      onClick={() => {
                        setEditingId(c.id);
                        setEditingBody(c.body);
                      }}
                    >
                      {t('commentEdit')}
                    </button>
                    {canManage ? (
                      <button
                        type="button"
                        className="hover:text-destructive"
                        onClick={() => remove.mutate({ commentId: c.id })}
                        disabled={remove.isPending}
                      >
                        {t('commentDelete')}
                      </button>
                    ) : null}
                  </div>
                </div>
                {editingId === c.id ? (
                  <div className="mt-2 space-y-2">
                    <Textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      rows={3}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingId(null);
                          setEditingBody('');
                        }}
                      >
                        {tCommon('cancel')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          update.mutate({ commentId: c.id, body: editingBody.trim() })
                        }
                        disabled={
                          update.isPending || editingBody.trim().length === 0
                        }
                      >
                        {tCommon('save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm">{c.body}</p>
                )}
              </li>
            ))
          )}
        </ul>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim().length === 0) return;
            create.mutate({ issueId, body: body.trim() });
          }}
        >
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t('addCommentPlaceholder')}
            rows={3}
            maxLength={20_000}
          />
          <div className="flex justify-end">
            <Button type="submit" disabled={create.isPending || body.trim().length === 0}>
              {t('addCommentButton')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function EditObservationDialog({
  open,
  onOpenChange,
  issueId,
  initialTitle,
  initialDescription,
  initialSiteId,
  initialDateOccurred,
  sites,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  issueId: string;
  initialTitle: string;
  initialDescription: string;
  initialSiteId: string;
  initialDateOccurred: string;
  sites: ReadonlyArray<{ id: string; name: string }>;
}) {
  const t = useTranslations('issues.detail');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [siteId, setSiteId] = useState(initialSiteId);
  const [dateOccurred, setDateOccurred] = useState(initialDateOccurred);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setDescription(initialDescription);
      setSiteId(initialSiteId);
      setDateOccurred(initialDateOccurred);
    }
  }, [open, initialTitle, initialDescription, initialSiteId, initialDateOccurred]);

  const update = trpc.issues.issues.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      void utils.issues.issues.get.invalidate({ issueId });
      onOpenChange(false);
    },
    onError: () => toast.error(tCommon('error')),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0) return;
    const input: {
      issueId: string;
      title?: string;
      description?: string | null;
      dateOccurred?: string;
      siteId?: string | null;
    } = { issueId };
    if (trimmedTitle !== initialTitle) input.title = trimmedTitle;
    if (description.trim() !== initialDescription.trim()) {
      input.description = description.trim().length > 0 ? description.trim() : null;
    }
    if (siteId !== initialSiteId) {
      input.siteId = siteId === '' ? null : siteId;
    }
    if (dateOccurred !== initialDateOccurred && dateOccurred !== '') {
      input.dateOccurred = new Date(dateOccurred).toISOString();
    }
    update.mutate(input);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editDialogTitle')}</DialogTitle>
          <DialogDescription />
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">{t('editTitleLabel')}</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-description">{t('editDescriptionLabel')}</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={20_000}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-site">{t('editSiteLabel')}</Label>
            <select
              id="edit-site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-date">{t('editDateLabel')}</Label>
            <Input
              id="edit-date"
              type="datetime-local"
              value={dateOccurred}
              onChange={(e) => setDateOccurred(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CloseObservationDialog({
  open,
  onOpenChange,
  issueId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  issueId: string;
}) {
  const t = useTranslations('issues.detail');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const [reason, setReason] = useState('');

  const close = trpc.issues.issues.close.useMutation({
    onSuccess: () => {
      toast.success(t('closeToast'));
      void utils.issues.issues.get.invalidate({ issueId });
      onOpenChange(false);
    },
    onError: () => toast.error(tCommon('error')),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('closeDialogTitle')}</DialogTitle>
          <DialogDescription>{t('closeDialogBody')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input: { issueId: string; reason?: string } = { issueId };
            const trimmed = reason.trim();
            if (trimmed.length > 0) input.reason = trimmed;
            close.mutate(input);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="close-reason">{t('closeReasonPlaceholder')}</Label>
            <Textarea
              id="close-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={close.isPending}>
              {t('closeButton')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(d: Date | string): string {
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

function toLocalDatetime(d: Date | string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  // Format as YYYY-MM-DDTHH:mm for <input type="datetime-local">.
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
