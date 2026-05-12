'use client';

import type { IssueNotificationRule } from '@forma360/shared/issues-schema';
import { ArrowLeft } from 'lucide-react';
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
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Switch } from '../../../../src/components/ui/switch';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

const NOTIFICATION_RULES: readonly IssueNotificationRule[] = ['private', 'summary', 'detailed'];

interface CategoryFormState {
  name: string;
  description: string;
  notificationRule: IssueNotificationRule;
  criticalAlerts: boolean;
  accessRuleId: string;
  linkedTemplateIds: string[];
}

const EMPTY_FORM: CategoryFormState = {
  name: '',
  description: '',
  notificationRule: 'summary',
  criticalAlerts: false,
  accessRuleId: '',
  linkedTemplateIds: [],
};

/**
 * Issue categories admin. Gated by `issues.settings` — non-admins are
 * redirected to the issues list. Lets admins create / edit / archive /
 * restore / delete categories.
 *
 * Custom-field and custom-question editing is deferred to a follow-on
 * PR; for now the dialog handles the headline fields only.
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
  const { data: templates } = trpc.templates.list.useQuery({});

  const [dialogState, setDialogState] = useState<
    { mode: 'create'; form: CategoryFormState } | { mode: 'edit'; categoryId: string; form: CategoryFormState } | null
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
          <Button onClick={() => setDialogState({ mode: 'create', form: EMPTY_FORM })}>
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
                              form: {
                                name: c.name,
                                description: c.description ?? '',
                                notificationRule:
                                  (c.notificationRule as IssueNotificationRule) ?? 'summary',
                                criticalAlerts: c.criticalAlerts,
                                accessRuleId: c.accessRuleId ?? '',
                                linkedTemplateIds: Array.from(c.linkedTemplateIds),
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
        <CategoryDialog
          state={dialogState}
          onClose={() => setDialogState(null)}
          accessRules={accessRules ?? []}
          templates={templates ?? []}
        />
      ) : null}
    </div>
  );
}

function CategoryDialog({
  state,
  onClose,
  accessRules,
  templates,
}: {
  state:
    | { mode: 'create'; form: CategoryFormState }
    | { mode: 'edit'; categoryId: string; form: CategoryFormState };
  onClose: () => void;
  accessRules: ReadonlyArray<{ id: string; name: string }>;
  templates: ReadonlyArray<{ id: string; name: string; archivedAt: Date | null }>;
}) {
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');
  const utils = trpc.useUtils();

  const [form, setForm] = useState<CategoryFormState>(state.form);

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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (name.length === 0) return;

    if (state.mode === 'create') {
      const input: {
        name: string;
        description?: string;
        accessRuleId?: string;
        notificationRule?: IssueNotificationRule;
        criticalAlerts?: boolean;
        linkedTemplateIds?: string[];
      } = {
        name,
        notificationRule: form.notificationRule,
        criticalAlerts: form.criticalAlerts,
      };
      const desc = form.description.trim();
      if (desc.length > 0) input.description = desc;
      if (form.accessRuleId !== '') input.accessRuleId = form.accessRuleId;
      if (form.linkedTemplateIds.length > 0) input.linkedTemplateIds = form.linkedTemplateIds;
      create.mutate(input);
    } else {
      const input: {
        categoryId: string;
        name?: string;
        description?: string | null;
        accessRuleId?: string | null;
        notificationRule?: IssueNotificationRule;
        criticalAlerts?: boolean;
        linkedTemplateIds?: string[];
      } = { categoryId: state.categoryId };
      if (name !== state.form.name) input.name = name;
      const desc = form.description.trim();
      if (desc !== (state.form.description ?? '').trim()) {
        input.description = desc.length > 0 ? desc : null;
      }
      if (form.accessRuleId !== state.form.accessRuleId) {
        input.accessRuleId = form.accessRuleId === '' ? null : form.accessRuleId;
      }
      if (form.notificationRule !== state.form.notificationRule) {
        input.notificationRule = form.notificationRule;
      }
      if (form.criticalAlerts !== state.form.criticalAlerts) {
        input.criticalAlerts = form.criticalAlerts;
      }
      if (
        JSON.stringify(form.linkedTemplateIds) !== JSON.stringify(state.form.linkedTemplateIds)
      ) {
        input.linkedTemplateIds = form.linkedTemplateIds;
      }
      update.mutate(input);
    }
  }

  const submitting = create.isPending || update.isPending;
  const availableTemplates = templates.filter((tpl) => tpl.archivedAt === null);

  return (
    <Dialog open onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state.mode === 'create' ? t('createTitle') : t('editTitle')}
          </DialogTitle>
          <DialogDescription>
            {state.mode === 'create' ? t('createSubtitle') : t('editSubtitle')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">{t('nameLabel')}</Label>
            <Input
              id="cat-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">{t('descriptionLabel')}</Label>
            <Textarea
              id="cat-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              maxLength={2000}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-notif">{t('notificationRuleLabel')}</Label>
            <select
              id="cat-notif"
              value={form.notificationRule}
              onChange={(e) =>
                setForm({ ...form, notificationRule: e.target.value as IssueNotificationRule })
              }
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {NOTIFICATION_RULES.map((r) => (
                <option key={r} value={r}>
                  {t(`notificationRule.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="cat-critical"
              checked={form.criticalAlerts}
              onCheckedChange={(v) => setForm({ ...form, criticalAlerts: v })}
            />
            <Label htmlFor="cat-critical">{t('criticalAlertsLabel')}</Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-access">{t('accessRuleLabel')}</Label>
            <select
              id="cat-access"
              value={form.accessRuleId}
              onChange={(e) => setForm({ ...form, accessRuleId: e.target.value })}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('accessRuleNone')}</option>
              {accessRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-templates">{t('linkedTemplatesLabel')}</Label>
            <select
              id="cat-templates"
              multiple
              value={form.linkedTemplateIds}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                setForm({ ...form, linkedTemplateIds: selected });
              }}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              size={Math.min(5, Math.max(3, availableTemplates.length))}
            >
              {availableTemplates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t('linkedTemplatesHelp')}</p>
          </div>
          <p className="text-xs text-muted-foreground">{t('customFieldsDeferred')}</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('cancelButton')}
            </Button>
            <Button type="submit" disabled={submitting || form.name.trim().length === 0}>
              {t('saveButton')}
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
