'use client';

import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Archive } from 'lucide-react';
import { Button } from '../../../../src/components/ui/button';
import { TooltipIconButton } from '../../../../src/components/ui/tooltip-icon-button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';
import { formatDate } from '../../../../src/lib/format-date';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;

/**
 * Observation categories admin. Gated by `issues.settings` — non-admins
 * are redirected to the observations list. The list view shows every
 * category in the tenant, with a small "+ Add category" Dialog that
 * collects only Name + Description and then lands the admin on the
 * detail page where the rest (notifications, custom questions, linked
 * templates, visibility) is configured.
 *
 * The Edit row action also navigates to the detail page now — the
 * inline-edit wizard has been retired (see custom-questions-editor.tsx
 * for the reusable question builder).
 */
export default function CategoriesPage() {
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');
  const onServerError = useServerErrorToast(tCommon('error'));
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const utils = trpc.useUtils();

  const canManageSettings = useHasPermission('issues.settings');
  useEffect(() => {
    if (!canManageSettings) {
      toast.error(tCommon('error'));
      router.push(`/${locale}/observations`);
    }
  }, [canManageSettings, locale, router, tCommon]);

  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: categories, isLoading } = trpc.issues.categories.list.useQuery({
    includeArchived,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const notificationRuleLabel = (rule: string): string =>
    t(`notificationRule.${rule === 'private' || rule === 'detailed' ? rule : 'summary'}`);

  const archive = trpc.issues.categories.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.issues.categories.list.invalidate();
    },
    onError: onServerError,
  });

  const restore = trpc.issues.categories.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.issues.categories.list.invalidate();
    },
    onError: onServerError,
  });

  const remove = trpc.issues.categories.delete.useMutation({
    onSuccess: () => {
      toast.success(t('deleteToast'));
      setDeleteTarget(null);
      void utils.issues.categories.list.invalidate();
    },
    onError: onServerError,
  });

  const list = categories ?? [];

  function actionsFor(c: (typeof list)[number]) {
    return (
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/${locale}/observations/categories/${c.id}`)}
        >
          {tCommon('edit')}
        </Button>
        {c.archivedAt === null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => archive.mutate({ categoryId: c.id })}
            disabled={archive.isPending}
          >
            {tCommon('archive')}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => restore.mutate({ categoryId: c.id })}
              disabled={restore.isPending}
            >
              {t('restoreButton')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => setDeleteTarget({ id: c.id, name: c.name })}
              disabled={remove.isPending}
            >
              {tCommon('delete')}
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <TooltipIconButton
            icon={Archive}
            label={includeArchived ? tCommon('hideArchived') : tCommon('showArchived')}
            active={includeArchived}
            onClick={() => setIncludeArchived((v) => !v)}
          />
          <Button onClick={() => setCreateOpen(true)}>{t('newButton')}</Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          {/* Desktop / tablet table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.description')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.notifications')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.criticalAlerts')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.archived')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.created')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ) : list.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  list.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.description ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {notificationRuleLabel(c.notificationRule)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <span
                          aria-label={c.criticalAlerts ? t('criticalOn') : t('criticalOff')}
                          title={c.criticalAlerts ? t('criticalOn') : t('criticalOff')}
                        >
                          {c.criticalAlerts ? '✓' : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <span
                          aria-label={c.archivedAt !== null ? t('archivedYes') : t('archivedNo')}
                          title={c.archivedAt !== null ? t('archivedYes') : t('archivedNo')}
                        >
                          {c.archivedAt !== null ? '✓' : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{formatDate(c.createdAt)}</td>
                      <td className="px-3 py-2 text-right">{actionsFor(c)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="divide-y md:hidden">
            {isLoading ? (
              <div className="p-4">
                <Skeleton className="h-24 w-full" />
              </div>
            ) : list.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">{t('empty')}</div>
            ) : (
              list.map((c) => (
                <div key={c.id} className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{c.name}</div>
                      {c.description !== null && c.description.length > 0 ? (
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                          {c.description}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">{t('columns.notifications')}:</dt>
                      <dd>{notificationRuleLabel(c.notificationRule)}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted-foreground">{t('columns.criticalAlerts')}:</dt>
                      <dd>{c.criticalAlerts ? t('criticalOn') : t('criticalOff')}</dd>
                    </div>
                    {c.archivedAt !== null ? (
                      <div className="flex items-center gap-1.5">
                        <dd className="font-medium text-muted-foreground">{t('archivedYes')}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {actionsFor(c)}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {deleteTarget !== null ? (
        <Dialog open onOpenChange={(v) => !v && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>
                {t('deleteConfirmBody', { name: deleteTarget.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)}>
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => remove.mutate({ categoryId: deleteTarget.id })}
                disabled={remove.isPending}
              >
                {tCommon('delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {createOpen ? (
        <CreateCategoryDialog open={createOpen} onOpenChange={setCreateOpen} locale={locale} />
      ) : null}
    </div>
  );
}

function CreateCategoryDialog({
  open,
  onOpenChange,
  locale,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  locale: string;
}) {
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');
  const onServerError1 = useServerErrorToast(tCommon('error'));
  const utils = trpc.useUtils();
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = trpc.issues.categories.create.useMutation({
    onSuccess: (result) => {
      toast.success(t('createToast'));
      void utils.issues.categories.list.invalidate();
      onOpenChange(false);
      router.push(`/${locale}/observations/categories/${result.categoryId}`);
    },
    onError: onServerError1,
  });

  const canSubmit = name.trim().length > 0 && !create.isPending;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const input: {
      name: string;
      description?: string;
      notificationRule: 'private' | 'summary' | 'detailed';
      criticalAlerts: boolean;
      customFields: never[];
      customQuestions: never[];
      linkedTemplateIds: string[];
    } = {
      name: name.trim(),
      notificationRule: 'summary',
      criticalAlerts: false,
      customFields: [],
      customQuestions: [],
      linkedTemplateIds: [],
    };
    if (description.trim().length > 0) input.description = description.trim();
    create.mutate(input);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('createDialogTitle')}</DialogTitle>
          <DialogDescription>{t('createDialogSubtitle')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">{t('nameLabel')}</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME}
              required
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">{t('descriptionLabel')}</Label>
            <Textarea
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={MAX_DESCRIPTION}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t('createSaveButton')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
