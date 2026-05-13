'use client';

import type {
  IssueCustomQuestion,
  IssueNotificationRule,
} from '@forma360/shared/issues-schema';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CategoryWizard,
  EMPTY_CATEGORY_WIZARD_VALUES,
  type CategoryWizardSubmit,
  type CategoryWizardValues,
} from '../../../../src/components/issues/category-wizard';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
} from '../../../../src/components/ui/dialog';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

/**
 * Issue categories admin. Gated by `issues.settings` — non-admins are
 * redirected to the issues list. Lets admins create / edit / archive /
 * restore / delete categories.
 *
 * The create / edit Dialog hosts a 3-step wizard (Basics → Questions →
 * Access). Linked-template selection is deferred and intentionally not
 * surfaced; the schema accepts it (we always send an empty array).
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
      router.push(`/${locale}/issues`);
    }
  }, [canManageSettings, locale, router, tCommon]);

  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: categories, isLoading } = trpc.issues.categories.list.useQuery({
    includeArchived,
  });
  const { data: accessRules } = trpc.accessRules.list.useQuery();

  const [dialogState, setDialogState] = useState<
    | { mode: 'create'; values: CategoryWizardValues }
    | { mode: 'edit'; categoryId: string; values: CategoryWizardValues }
    | null
  >(null);

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
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/issues`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('backLink')}
        </Link>
      </div>
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
          <Button
            onClick={() =>
              setDialogState({ mode: 'create', values: EMPTY_CATEGORY_WIZARD_VALUES })
            }
          >
            {t('newButton')}
          </Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
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
                    <td className="px-3 py-2 text-muted-foreground">
                      {c.description ?? '—'}
                    </td>
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
                            setDialogState({
                              mode: 'edit',
                              categoryId: c.id,
                              values: {
                                name: c.name,
                                description: c.description ?? '',
                                notificationRule:
                                  (c.notificationRule as IssueNotificationRule) ?? 'summary',
                                criticalAlerts: c.criticalAlerts,
                                accessRuleId: c.accessRuleId ?? '',
                                customQuestions: Array.from(c.customQuestions) as IssueCustomQuestion[],
                              },
                            })
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
        </CardContent>
      </Card>

      {dialogState !== null ? (
        <CategoryWizardDialog
          state={dialogState}
          onClose={() => setDialogState(null)}
          accessRules={accessRules ?? []}
        />
      ) : null}
    </div>
  );
}

function CategoryWizardDialog({
  state,
  onClose,
  accessRules,
}: {
  state:
    | { mode: 'create'; values: CategoryWizardValues }
    | { mode: 'edit'; categoryId: string; values: CategoryWizardValues };
  onClose: () => void;
  accessRules: ReadonlyArray<{ id: string; name: string }>;
}) {
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const create = trpc.issues.categories.create.useMutation({
    onSuccess: () => {
      toast.success(t('createToast'));
      void utils.issues.categories.list.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const update = trpc.issues.categories.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      void utils.issues.categories.list.invalidate();
      onClose();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function handleSave(values: CategoryWizardSubmit) {
    if (state.mode === 'create') {
      const input: {
        name: string;
        description?: string;
        accessRuleId?: string;
        notificationRule?: IssueNotificationRule;
        criticalAlerts?: boolean;
        customFields?: never[];
        customQuestions?: IssueCustomQuestion[];
        linkedTemplateIds?: string[];
      } = {
        name: values.name,
        notificationRule: values.notificationRule,
        criticalAlerts: values.criticalAlerts,
        customFields: [],
        customQuestions: values.customQuestions,
        linkedTemplateIds: [],
      };
      if (values.description.length > 0) input.description = values.description;
      if (values.accessRuleId !== '') input.accessRuleId = values.accessRuleId;
      create.mutate(input);
    } else {
      // Send only diffs. customQuestions is always sent so the schema sees
      // the wizard's final state even when the count is the same.
      const original = state.values;
      const input: {
        categoryId: string;
        name?: string;
        description?: string | null;
        accessRuleId?: string | null;
        notificationRule?: IssueNotificationRule;
        criticalAlerts?: boolean;
        customFields?: never[];
        customQuestions?: IssueCustomQuestion[];
        linkedTemplateIds?: string[];
      } = { categoryId: state.categoryId };
      if (values.name !== original.name.trim()) input.name = values.name;
      const originalDesc = original.description.trim();
      if (values.description !== originalDesc) {
        input.description = values.description.length > 0 ? values.description : null;
      }
      if (values.accessRuleId !== original.accessRuleId) {
        input.accessRuleId = values.accessRuleId === '' ? null : values.accessRuleId;
      }
      if (values.notificationRule !== original.notificationRule) {
        input.notificationRule = values.notificationRule;
      }
      if (values.criticalAlerts !== original.criticalAlerts) {
        input.criticalAlerts = values.criticalAlerts;
      }
      if (
        JSON.stringify(values.customQuestions) !==
        JSON.stringify(original.customQuestions)
      ) {
        input.customQuestions = values.customQuestions;
      }
      update.mutate(input);
    }
  }

  const submitting = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent>
        <CategoryWizard
          mode={state.mode}
          defaultValues={state.values}
          accessRules={accessRules}
          submitting={submitting}
          onSave={handleSave}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function formatDate(d: Date | string): string {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString();
}
