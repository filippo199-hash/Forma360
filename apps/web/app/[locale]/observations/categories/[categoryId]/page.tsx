'use client';

import type {
  IssueCustomQuestion,
  IssueNotificationRule,
  IssueToggleableBuiltInField,
} from '@forma360/shared/issues-schema';
import { ArrowLeft, ImageIcon, MapPin, Pencil, Type as TypeIcon, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CustomQuestionsEditor,
  customQuestionsAreValid,
  normaliseCustomQuestions,
} from '../../../../../src/components/observations/custom-questions-editor';
import { GroupPicker, SitePicker } from '../../../../../src/components/templates/audience-pickers';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../src/components/ui/dialog';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Switch } from '../../../../../src/components/ui/switch';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const NOTIFICATION_RULES: readonly IssueNotificationRule[] = ['private', 'summary', 'detailed'];

type Tab = 'workflow' | 'access';

/**
 * Category detail page. Two-tab in-page strip (Workflow | Access) with
 * stacked cards on each tab. Mirrors the SafetyCulture pattern from the
 * audit. Each card has its own edit/save state — the page does NOT
 * collect a single batched edit.
 *
 * Cards on Workflow: Category details, Notifications (rule + critical
 * alerts split), Custom questions, Linked templates. The "Issue fields"
 * (toggleable built-ins) card is intentionally deferred to PR-3 — it
 * needs a new schema column.
 *
 * Cards on Access: Category visibility (rule editor) + a read-only
 * "Access" info card.
 */
export default function CategoryDetailPage() {
  const t = useTranslations('issues.categories');
  const tDetail = useTranslations('issues.categories.detail');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; categoryId: string }>();
  const locale = params.locale ?? 'en';
  const categoryId = params.categoryId ?? '';
  const router = useRouter();
  const utils = trpc.useUtils();

  const canManageSettings = useHasPermission('issues.settings');
  useEffect(() => {
    if (!canManageSettings) {
      toast.error(tCommon('error'));
      router.push(`/${locale}/observations`);
    }
  }, [canManageSettings, locale, router, tCommon]);

  const { data: category, isLoading } = trpc.issues.categories.get.useQuery(
    { categoryId },
    { enabled: categoryId !== '' && canManageSettings },
  );

  const [activeTab, setActiveTab] = useState<Tab>('workflow');
  const [deleteOpen, setDeleteOpen] = useState(false);

  const archive = trpc.issues.categories.archive.useMutation({
    onSuccess: () => {
      toast.success(t('archiveToast'));
      router.push(`/${locale}/observations/categories`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function invalidateCategory() {
    void utils.issues.categories.get.invalidate({ categoryId });
    void utils.issues.categories.list.invalidate();
  }

  if (isLoading || category === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/observations/categories`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {tDetail('backLink')}
        </Link>
      </div>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          <Link
            href={`/${locale}/observations/categories`}
            className="hover:text-foreground hover:underline"
          >
            {tDetail('breadcrumb')}
          </Link>
          <span className="mx-2">/</span>
          <span className="font-medium text-foreground">{category.name}</span>
        </div>
        <Button
          type="button"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          {tDetail('deleteButton')}
        </Button>
      </header>

      <nav className="border-b" aria-label={tDetail('tabWorkflow')}>
        <div className="flex gap-6">
          <TabButton
            active={activeTab === 'workflow'}
            onClick={() => setActiveTab('workflow')}
            label={tDetail('tabWorkflow')}
          />
          <TabButton
            active={activeTab === 'access'}
            onClick={() => setActiveTab('access')}
            label={tDetail('tabAccess')}
          />
        </div>
      </nav>

      {activeTab === 'workflow' ? (
        <div className="space-y-4">
          <CategoryDetailsCard
            categoryId={categoryId}
            name={category.name}
            description={category.description}
            onSaved={invalidateCategory}
          />
          <NotificationsCard
            categoryId={categoryId}
            notificationRule={category.notificationRule as IssueNotificationRule}
            onSaved={invalidateCategory}
          />
          <CriticalAlertsCard
            categoryId={categoryId}
            criticalAlerts={category.criticalAlerts}
            onSaved={invalidateCategory}
          />
          <IssueFieldsCard
            categoryId={categoryId}
            enabledBuiltInFields={
              Array.from(category.enabledBuiltInFields) as IssueToggleableBuiltInField[]
            }
            onSaved={invalidateCategory}
          />
          <CustomQuestionsCard
            categoryId={categoryId}
            customQuestions={Array.from(category.customQuestions) as IssueCustomQuestion[]}
            onSaved={invalidateCategory}
          />
          <LinkedTemplatesCard
            categoryId={categoryId}
            linkedTemplateIds={Array.from(category.linkedTemplateIds) as string[]}
            onSaved={invalidateCategory}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <VisibilityCard
            categoryId={categoryId}
            categoryName={category.name}
            accessRuleId={category.accessRuleId ?? null}
            onSaved={invalidateCategory}
          />
          <AccessInfoCard />
        </div>
      )}

      {deleteOpen ? (
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tDetail('deleteConfirmTitle')}</DialogTitle>
              <DialogDescription>{tDetail('deleteConfirmBody')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>
                {tDetail('deleteCancel')}
              </Button>
              <Button
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => archive.mutate({ categoryId })}
                disabled={archive.isPending}
              >
                {tDetail('deleteConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
      className={
        '-mb-px border-b-2 px-1 py-3 text-sm font-medium transition-colors ' +
        (active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground')
      }
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </button>
  );
}

function CardShell({
  title,
  subtitle,
  editing,
  onEdit,
  onCancel,
  onSave,
  saveDisabled,
  saving,
  children,
}: {
  title: string;
  subtitle: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  saving: boolean;
  children: React.ReactNode;
}) {
  const tDetail = useTranslations('issues.categories.detail');
  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {!editing ? (
            <Button type="button" variant="outline" size="sm" onClick={onEdit}>
              <Pencil className="mr-1 h-4 w-4" />
              {tDetail('editButton')}
            </Button>
          ) : null}
        </div>
        <div className="pt-2">{children}</div>
        {editing ? (
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {tDetail('cancelCard')}
            </Button>
            <Button type="button" size="sm" onClick={onSave} disabled={saveDisabled || saving}>
              {tDetail('saveCard')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CategoryDetailsCard({
  categoryId,
  name,
  description,
  onSaved,
}: {
  categoryId: string;
  name: string;
  description: string | null;
  onSaved: () => void;
}) {
  const tDetail = useTranslations('issues.categories.detail');
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');

  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftDesc, setDraftDesc] = useState(description ?? '');

  useEffect(() => {
    setDraftName(name);
    setDraftDesc(description ?? '');
  }, [name, description]);

  const update = trpc.issues.categories.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      setEditing(false);
      onSaved();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function onSave() {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) return;
    const input: {
      categoryId: string;
      name?: string;
      description?: string | null;
    } = { categoryId };
    if (trimmed !== name) input.name = trimmed;
    const newDesc = draftDesc.trim().length > 0 ? draftDesc.trim() : null;
    if (newDesc !== description) input.description = newDesc;
    update.mutate(input);
  }

  return (
    <CardShell
      title={tDetail('detailsCard.title')}
      subtitle={tDetail('detailsCard.subtitle')}
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => {
        setDraftName(name);
        setDraftDesc(description ?? '');
        setEditing(false);
      }}
      onSave={onSave}
      saveDisabled={draftName.trim().length === 0}
      saving={update.isPending}
    >
      {editing ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-detail-name">{tDetail('detailsCard.nameLabel')}</Label>
            <Input
              id="cat-detail-name"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              maxLength={MAX_NAME}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-detail-desc">{tDetail('detailsCard.descriptionLabel')}</Label>
            <Textarea
              id="cat-detail-desc"
              value={draftDesc}
              onChange={(e) => setDraftDesc(e.target.value)}
              rows={3}
              maxLength={MAX_DESCRIPTION}
            />
          </div>
        </div>
      ) : (
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {tDetail('detailsCard.nameLabel')}
            </dt>
            <dd className="mt-1 font-medium">{name}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {tDetail('detailsCard.descriptionLabel')}
            </dt>
            <dd className="mt-1">
              {description !== null && description.length > 0
                ? description
                : tDetail('detailsCard.descriptionEmpty')}
            </dd>
          </div>
        </dl>
      )}
    </CardShell>
  );
}

function NotificationsCard({
  categoryId,
  notificationRule,
  onSaved,
}: {
  categoryId: string;
  notificationRule: IssueNotificationRule;
  onSaved: () => void;
}) {
  const tDetail = useTranslations('issues.categories.detail');
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IssueNotificationRule>(notificationRule);
  useEffect(() => setDraft(notificationRule), [notificationRule]);

  const update = trpc.issues.categories.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      setEditing(false);
      onSaved();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <CardShell
      title={tDetail('notificationsCard.title')}
      subtitle={tDetail('notificationsCard.subtitle')}
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => {
        setDraft(notificationRule);
        setEditing(false);
      }}
      onSave={() => update.mutate({ categoryId, notificationRule: draft })}
      saveDisabled={draft === notificationRule}
      saving={update.isPending}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{tDetail('notificationsCard.recipientsLabel')}</Label>
          <p className="text-sm text-muted-foreground">
            {tDetail('notificationsCard.recipientsPlaceholder')}
          </p>
        </div>

        <div className="space-y-2">
          <Label>{tDetail('notificationsCard.emailTypeLabel')}</Label>
          {editing ? (
            <fieldset className="space-y-2">
              {NOTIFICATION_RULES.map((rule) => (
                <label
                  key={rule}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/30"
                >
                  <input
                    type="radio"
                    name="notif-rule"
                    value={rule}
                    checked={draft === rule}
                    onChange={() => setDraft(rule)}
                    className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                  />
                  <div>
                    <div className="font-medium">{t(`notificationRule.${rule}`)}</div>
                    <div className="text-sm text-muted-foreground">
                      {t(`notificationRuleDescriptions.${rule}`)}
                    </div>
                  </div>
                </label>
              ))}
            </fieldset>
          ) : (
            <div className="rounded-md border p-3 text-sm">
              <div className="font-medium">{t(`notificationRule.${notificationRule}`)}</div>
              <div className="mt-1 text-muted-foreground">
                {t(`notificationRuleDescriptions.${notificationRule}`)}
              </div>
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}

function CriticalAlertsCard({
  categoryId,
  criticalAlerts,
  onSaved,
}: {
  categoryId: string;
  criticalAlerts: boolean;
  onSaved: () => void;
}) {
  const tDetail = useTranslations('issues.categories.detail');
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(criticalAlerts);
  useEffect(() => setDraft(criticalAlerts), [criticalAlerts]);

  const update = trpc.issues.categories.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      setEditing(false);
      onSaved();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  return (
    <CardShell
      title={tDetail('criticalCard.title')}
      subtitle={tDetail('criticalCard.subtitle')}
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => {
        setDraft(criticalAlerts);
        setEditing(false);
      }}
      onSave={() => update.mutate({ categoryId, criticalAlerts: draft })}
      saveDisabled={draft === criticalAlerts}
      saving={update.isPending}
    >
      <div className="flex items-center gap-3">
        <Switch
          id="cat-critical"
          checked={editing ? draft : criticalAlerts}
          onCheckedChange={(v) => setDraft(v)}
          disabled={!editing}
        />
        <Label htmlFor="cat-critical">{tDetail('criticalCard.sendLabel')}</Label>
      </div>
    </CardShell>
  );
}

function CustomQuestionsCard({
  categoryId,
  customQuestions,
  onSaved,
}: {
  categoryId: string;
  customQuestions: IssueCustomQuestion[];
  onSaved: () => void;
}) {
  const tDetail = useTranslations('issues.categories.detail');
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IssueCustomQuestion[]>(customQuestions);
  useEffect(() => setDraft(customQuestions), [customQuestions]);

  const update = trpc.issues.categories.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      setEditing(false);
      onSaved();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  const valid = customQuestionsAreValid(draft);

  return (
    <CardShell
      title={tDetail('questionsCard.title')}
      subtitle={tDetail('questionsCard.subtitle')}
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => {
        setDraft(customQuestions);
        setEditing(false);
      }}
      onSave={() => update.mutate({ categoryId, customQuestions: normaliseCustomQuestions(draft) })}
      saveDisabled={!valid}
      saving={update.isPending}
    >
      <div className="space-y-3">
        <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          {tDetail('questionsCard.banner')}
        </div>
        {editing ? (
          <CustomQuestionsEditor questions={draft} onChange={setDraft} />
        ) : customQuestions.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-2">
            {customQuestions.map((q) => (
              <li key={q.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{q.prompt}</span>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {q.type === 'text'
                      ? t('questionBuilder.typeText')
                      : t('questionBuilder.typeMultipleChoice')}
                  </span>
                </div>
                {q.required ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('questionBuilder.requiredLabel')}
                  </p>
                ) : null}
                {q.type === 'multipleChoice' && q.options !== undefined ? (
                  <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                    {q.options.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </CardShell>
  );
}

function LinkedTemplatesCard({
  categoryId,
  linkedTemplateIds,
  onSaved,
}: {
  categoryId: string;
  linkedTemplateIds: string[];
  onSaved: () => void;
}) {
  const tDetail = useTranslations('issues.categories.detail');
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(linkedTemplateIds);
  useEffect(() => setDraft(linkedTemplateIds), [linkedTemplateIds]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerDraft, setPickerDraft] = useState<string[]>([]);

  const { data: templates } = trpc.templates.list.useQuery({ status: 'published' });

  const templateById = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const tpl of templates ?? []) {
      map.set(tpl.id, { id: tpl.id, name: tpl.name });
    }
    return map;
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const all = templates ?? [];
    const needle = pickerSearch.trim().toLowerCase();
    if (needle === '') return all;
    return all.filter((tpl) => tpl.name.toLowerCase().includes(needle));
  }, [templates, pickerSearch]);

  const update = trpc.issues.categories.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      setEditing(false);
      onSaved();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function openPicker() {
    setPickerDraft([...draft]);
    setPickerSearch('');
    setPickerOpen(true);
  }

  function togglePickerDraft(id: string) {
    setPickerDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function commitPicker() {
    setDraft(pickerDraft);
    setPickerOpen(false);
  }

  function removeChip(id: string) {
    setDraft((prev) => prev.filter((x) => x !== id));
  }

  return (
    <CardShell
      title={tDetail('linkedTemplatesCard.title')}
      subtitle={tDetail('linkedTemplatesCard.subtitle')}
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => {
        setDraft(linkedTemplateIds);
        setEditing(false);
      }}
      onSave={() => update.mutate({ categoryId, linkedTemplateIds: draft })}
      saveDisabled={
        JSON.stringify(draft.slice().sort()) === JSON.stringify(linkedTemplateIds.slice().sort())
      }
      saving={update.isPending}
    >
      <div className="space-y-3">
        {(editing ? draft : linkedTemplateIds).length === 0 ? (
          <p className="text-sm text-muted-foreground">{tDetail('linkedTemplatesCard.empty')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(editing ? draft : linkedTemplateIds).map((id) => {
              const tpl = templateById.get(id);
              const label = tpl?.name ?? id;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"
                >
                  {label}
                  {editing ? (
                    <button
                      type="button"
                      onClick={() => removeChip(id)}
                      aria-label={label}
                      className="rounded-full text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>
        )}
        {editing ? (
          <Button type="button" variant="outline" size="sm" onClick={openPicker}>
            {tDetail('linkedTemplatesCard.linkButton')}
          </Button>
        ) : null}

        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{tDetail('linkedTemplatesCard.dialogTitle')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder={tDetail('linkedTemplatesCard.dialogSearchPlaceholder')}
                aria-label={tDetail('linkedTemplatesCard.dialogSearchPlaceholder')}
              />
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
                {filteredTemplates.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    {tDetail('linkedTemplatesCard.dialogEmpty')}
                  </p>
                ) : (
                  filteredTemplates.map((tpl) => {
                    const checked = pickerDraft.includes(tpl.id);
                    return (
                      <label
                        key={tpl.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/40"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePickerDraft(tpl.id)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                        <span className="truncate">{tpl.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" onClick={commitPicker}>
                {tDetail('linkedTemplatesCard.dialogDone')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </CardShell>
  );
}

type VisibilityMode = 'everyone' | 'specific';

function VisibilityCard({
  categoryId,
  categoryName,
  accessRuleId,
  onSaved,
}: {
  categoryId: string;
  categoryName: string;
  accessRuleId: string | null;
  onSaved: () => void;
}) {
  const tDetail = useTranslations('issues.categories.detail');
  const tCommon = useTranslations('common');

  const { data: tenant } = trpc.tenants.get.useQuery();
  const { data: accessRules } = trpc.accessRules.list.useQuery();
  const { data: groups } = trpc.groups.list.useQuery();
  const { data: sites } = trpc.sites.list.useQuery();

  // Look up the rule in `accessRules.list` to read its groupIds / siteIds.
  // The list intentionally hides `[auto] %` rules; we name our auto-rules
  // `Category: {name}` so they are visible (and editable from this card).
  const currentRule = useMemo(() => {
    if (accessRuleId === null) return null;
    return (accessRules ?? []).find((r) => r.id === accessRuleId) ?? null;
  }, [accessRules, accessRuleId]);

  const [editing, setEditing] = useState(false);
  const [enabled, setEnabled] = useState<boolean>(accessRuleId !== null);
  const [mode, setMode] = useState<VisibilityMode>(accessRuleId === null ? 'everyone' : 'specific');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);

  // Hydrate local picker state once the current rule is fetched.
  useEffect(() => {
    setEnabled(accessRuleId !== null);
    setMode(accessRuleId === null ? 'everyone' : 'specific');
    if (currentRule !== null) {
      setGroupIds([...(currentRule.groupIds ?? [])]);
      setSiteIds([...(currentRule.siteIds ?? [])]);
    } else {
      setGroupIds([]);
      setSiteIds([]);
    }
  }, [accessRuleId, currentRule]);

  const createRule = trpc.accessRules.create.useMutation();
  const updateRule = trpc.accessRules.update.useMutation();
  const updateCategory = trpc.issues.categories.update.useMutation();

  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    try {
      const ruleName = `Category: ${categoryName}`;
      // Either turn the rule off (set categoryId.accessRuleId = null), or
      // create / update an access rule and link it.
      const effectiveMode: VisibilityMode = enabled ? mode : 'everyone';
      if (effectiveMode === 'everyone') {
        if (accessRuleId !== null) {
          await updateCategory.mutateAsync({ categoryId, accessRuleId: null });
        }
      } else if (currentRule !== null) {
        await updateRule.mutateAsync({
          id: currentRule.id,
          name: ruleName,
          groupIds,
          siteIds,
        });
        // No change to category.accessRuleId required.
      } else {
        const result = await createRule.mutateAsync({
          name: ruleName,
          groupIds,
          siteIds,
        });
        await updateCategory.mutateAsync({ categoryId, accessRuleId: result.id });
      }
      toast.success(tDetail('visibilityCard.saveSuccess'));
      setEditing(false);
      onSaved();
    } catch {
      toast.error(tDetail('visibilityCard.saveError'));
    } finally {
      setSaving(false);
    }
  }

  const tenantName = tenant?.tenant.name ?? '';

  const reportedBy = useMemo(() => {
    if (accessRuleId === null) {
      return tDetail('visibilityCard.everyone', { tenantName });
    }
    if (currentRule === null) {
      return tDetail('visibilityCard.specificSummary');
    }
    const groupLabels =
      (currentRule.groupIds ?? [])
        .map((id) => (groups ?? []).find((g) => g.id === id)?.name)
        .filter((x): x is string => x !== undefined) ?? [];
    const siteLabels =
      (currentRule.siteIds ?? [])
        .map((id) => (sites ?? []).find((s) => s.id === id)?.name)
        .filter((x): x is string => x !== undefined) ?? [];
    const all = [...groupLabels, ...siteLabels];
    if (all.length === 0) return tDetail('visibilityCard.specificEmpty');
    return all.join(', ');
  }, [accessRuleId, currentRule, groups, sites, tDetail, tenantName]);

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold">{tDetail('visibilityCard.title')}</h2>
              {editing ? (
                <div className="flex items-center gap-2">
                  <Switch
                    id="vis-enabled"
                    checked={enabled}
                    onCheckedChange={(v) => {
                      setEnabled(v);
                      if (!v) setMode('everyone');
                    }}
                  />
                  <Label htmlFor="vis-enabled" className="text-xs">
                    {tDetail('visibilityCard.enabledLabel')}
                  </Label>
                </div>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {tDetail('visibilityCard.subtitle')}
            </p>
          </div>
          {!editing ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-4 w-4" />
              {tDetail('editButton')}
            </Button>
          ) : null}
        </div>

        {!editing ? (
          <p className="text-sm">{reportedBy}</p>
        ) : (
          <div className="space-y-3">
            <fieldset className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/30">
                <input
                  type="radio"
                  name="vis-mode"
                  value="everyone"
                  checked={mode === 'everyone'}
                  onChange={() => setMode('everyone')}
                  disabled={!enabled}
                  className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                />
                <div>
                  <div className="font-medium">{tDetail('visibilityCard.everyoneOption')}</div>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-accent/30">
                <input
                  type="radio"
                  name="vis-mode"
                  value="specific"
                  checked={mode === 'specific'}
                  onChange={() => setMode('specific')}
                  disabled={!enabled}
                  className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                />
                <div>
                  <div className="font-medium">{tDetail('visibilityCard.specificOption')}</div>
                </div>
              </label>
            </fieldset>
            {enabled && mode === 'specific' ? (
              <div className="space-y-4">
                <GroupPicker selected={groupIds} onChange={setGroupIds} />
                <SitePicker selected={siteIds} onChange={setSiteIds} />
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEnabled(accessRuleId !== null);
                  setMode(accessRuleId === null ? 'everyone' : 'specific');
                  setGroupIds(currentRule !== null ? [...(currentRule.groupIds ?? [])] : []);
                  setSiteIds(currentRule !== null ? [...(currentRule.siteIds ?? [])] : []);
                  setEditing(false);
                }}
              >
                {tCommon('cancel')}
              </Button>
              <Button type="button" size="sm" onClick={onSave} disabled={saving}>
                {tCommon('save')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface IssueFieldRow {
  key: 'title' | IssueToggleableBuiltInField;
  required: boolean;
  Icon: React.ComponentType<{ className?: string }>;
}

const ISSUE_FIELD_ROWS: ReadonlyArray<IssueFieldRow> = [
  { key: 'title', required: true, Icon: TypeIcon },
  { key: 'description', required: false, Icon: TypeIcon },
  { key: 'site', required: false, Icon: MapPin },
  { key: 'media', required: false, Icon: ImageIcon },
  { key: 'location', required: false, Icon: MapPin },
];

function IssueFieldsCard({
  categoryId,
  enabledBuiltInFields,
  onSaved,
}: {
  categoryId: string;
  enabledBuiltInFields: IssueToggleableBuiltInField[];
  onSaved: () => void;
}) {
  const tDetail = useTranslations('issues.categories.detail');
  const t = useTranslations('issues.categories');
  const tCommon = useTranslations('common');

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<IssueToggleableBuiltInField[]>(enabledBuiltInFields);
  useEffect(() => setDraft(enabledBuiltInFields), [enabledBuiltInFields]);

  const update = trpc.issues.categories.update.useMutation({
    onSuccess: () => {
      toast.success(t('updateToast'));
      setEditing(false);
      onSaved();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function toggle(key: IssueToggleableBuiltInField) {
    setDraft((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const dirty = useMemo(() => {
    const a = [...draft].sort();
    const b = [...enabledBuiltInFields].sort();
    if (a.length !== b.length) return true;
    return a.some((v, i) => v !== b[i]);
  }, [draft, enabledBuiltInFields]);

  return (
    <CardShell
      title={tDetail('issueFieldsCard.title')}
      subtitle={tDetail('issueFieldsCard.subtitle')}
      editing={editing}
      onEdit={() => setEditing(true)}
      onCancel={() => {
        setDraft(enabledBuiltInFields);
        setEditing(false);
      }}
      onSave={() => update.mutate({ categoryId, enabledBuiltInFields: draft })}
      saveDisabled={!dirty}
      saving={update.isPending}
    >
      <ul className="divide-y rounded-md border">
        {ISSUE_FIELD_ROWS.map((row) => {
          const isToggleable = row.key !== 'title';
          const checked =
            row.key === 'title' ? true : draft.includes(row.key as IssueToggleableBuiltInField);
          return (
            <li key={row.key} className="flex items-center justify-between gap-3 p-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <row.Icon className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-medium">
                    {tDetail(`issueFieldsCard.rows.${row.key}`)}
                  </div>
                  {row.required ? (
                    <span className="text-xs text-muted-foreground">
                      {tDetail('issueFieldsCard.requiredBadge')}
                    </span>
                  ) : null}
                </div>
              </div>
              <Switch
                id={`built-in-${row.key}`}
                checked={checked}
                disabled={!editing || !isToggleable}
                onCheckedChange={() => {
                  if (!isToggleable) return;
                  toggle(row.key as IssueToggleableBuiltInField);
                }}
              />
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

function AccessInfoCard() {
  const tDetail = useTranslations('issues.categories.detail');
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div>
          <h2 className="text-base font-semibold">{tDetail('accessCard.title')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{tDetail('accessCard.subtitle')}</p>
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">{tDetail('accessCard.reporterLabel')}</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
              {tDetail('accessCard.reporterBadge')}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{tDetail('accessCard.reporterBody')}</p>
        </div>
        <p className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
          {tDetail('accessCard.note')}
        </p>
      </CardContent>
    </Card>
  );
}
