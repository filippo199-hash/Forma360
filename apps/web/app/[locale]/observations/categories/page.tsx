'use client';

import { useTranslations } from 'next-intl';
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
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

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

  const archive = trpc.issues.categories.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.issues.categories.list.invalidate();
    },
    onError: () => toast.error(tCommon('error')),
  });

  const restore = trpc.issues.categories.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.issues.categories.list.invalidate();
    },
    onError: () => toast.error(tCommon('error')),
  });

  const remove = trpc.issues.categories.delete.useMutation({
    onSuccess: () => {
      toast.success(t('deleteToast'));
      void utils.issues.categories.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="h-4 w-4"
            />
            <span>{t('showArchived')}</span>
          </label>
          <Button onClick={() => setCreateOpen(true)}>{t('newButton')}</Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
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
                ) : (categories ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  (categories ?? []).map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.description ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.notificationRule}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.criticalAlerts ? '✓' : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.archivedAt !== null ? '✓' : '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{formatDate(c.createdAt)}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              router.push(`/${locale}/observations/categories/${c.id}`)
                            }
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
                                onClick={() => remove.mutate({ categoryId: c.id })}
                                disabled={remove.isPending}
                              >
                                {tCommon('delete')}
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
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

function formatDate(d: Date | string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString();
}
