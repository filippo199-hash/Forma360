'use client';

import { ChevronLeft, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
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

/**
 * Action categories page — accessible directly from the Actions module.
 *
 * Manages action types (name, colour, custom questions, required fields,
 * visibility, transition rules). Surfaced here so operators don't need to
 * dig into Settings to manage categories; Settings → Actions keeps only
 * the priority due-date defaults.
 */
export default function ActionCategoriesPage() {
  const t = useTranslations('actionsSettings');
  const tCommon = useTranslations('common');
  const tActions = useTranslations('actions.list');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const utils = trpc.useUtils();
  const router = useRouter();

  const canSettings = useHasPermission('actions.settings');
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: types, isLoading } = trpc.actionTypes.list.useQuery({
    includeArchived: showArchived,
  });

  const archive = trpc.actionTypes.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      void utils.actionTypes.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const restore = trpc.actionTypes.restore.useMutation({
    onSuccess: () => {
      toast.success(t('restoreToast'));
      void utils.actionTypes.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const setDefault = trpc.actionTypes.setDefault.useMutation({
    onSuccess: () => {
      toast.success(t('setDefaultToast'));
      void utils.actionTypes.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <div className="mx-auto w-full max-w-[1200px] space-y-6">
      <div>
        <Link
          href={`/${locale}/actions`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {tActions('backToActions')}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t('typesHeading')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('typesSubtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4"
          />
          <span>{t('showArchived')}</span>
        </label>
        {canSettings ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newType')}
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">{t('columns.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.activeActions')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.questions')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.visibility')}</th>
                  <th className="px-3 py-2 font-medium">{t('columns.default')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ) : (types ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      {t('empty')}
                    </td>
                  </tr>
                ) : (
                  (types ?? []).map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">
                        <div className="flex items-center gap-2">
                          {row.color !== null && row.color.length > 0 ? (
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: row.color }}
                              aria-hidden="true"
                            />
                          ) : null}
                          <Link
                            href={`/${locale}/actions/categories/${row.id}`}
                            className="hover:underline"
                          >
                            {row.name}
                          </Link>
                          {row.archivedAt !== null ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                              {t('archivedBadge')}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{row.activeActions}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.customQuestions.length}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t(`visibility.${row.visibility}`)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {row.isDefault ? (
                          <span className="rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">
                            {t('defaultBadge')}
                          </span>
                        ) : canSettings && row.archivedAt === null ? (
                          <button
                            type="button"
                            onClick={() => setDefault.mutate({ typeId: row.id })}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            {t('setDefault')}
                          </button>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/${locale}/actions/categories/${row.id}`)}
                          >
                            {tCommon('edit')}
                          </Button>
                          {canSettings ? (
                            row.archivedAt === null ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => archive.mutate({ typeId: row.id })}
                                disabled={archive.isPending}
                              >
                                {tCommon('archive')}
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => restore.mutate({ typeId: row.id })}
                                disabled={restore.isPending}
                              >
                                {t('restoreButton')}
                              </Button>
                            )
                          ) : null}
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
  const t = useTranslations('actionsSettings.create');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#2563eb');

  const create = trpc.actionTypes.create.useMutation({
    onSuccess: (res) => {
      toast.success(t('createdToast'));
      void utils.actionTypes.list.invalidate();
      onOpenChange(false);
      router.push(`/${locale}/actions/categories/${res.typeId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const canSubmit = name.trim().length > 0 && !create.isPending;

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    const input: { name: string; description?: string; color?: string } = { name: name.trim() };
    if (description.trim().length > 0) input.description = description.trim();
    if (color !== '') input.color = color;
    create.mutate(input);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">{t('nameLabel')}</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              autoFocus
              placeholder={t('namePlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">{t('descriptionLabel')}</Label>
            <Textarea
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={t('descriptionPlaceholder')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-color">{t('colorLabel')}</Label>
            <Input
              id="cat-color"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-10 w-20 p-1"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t('createButton')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
