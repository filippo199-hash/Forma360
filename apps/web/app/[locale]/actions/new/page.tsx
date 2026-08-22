'use client';

import type { ActionCustomQuestion } from '@forma360/shared/actions-schema';
import { ChevronRight, Package } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Checkbox } from '../../../../src/components/ui/checkbox';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { SiteSelector } from '../../../../src/components/selectors/site-selector';
import { usePlaceTerms } from '../../../../src/lib/terminology';
import { GroupUserSelector } from '../../../../src/components/selectors/group-user-selector';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';
import { useServerErrorToast } from '../../../../src/lib/use-server-error';

type Priority = 'low' | 'medium' | 'high' | 'critical';
const PRIORITIES: ReadonlyArray<Priority> = ['low', 'medium', 'high', 'critical'];

/**
 * Standalone action creation page. The inspection-question and
 * observation-anchored entry points use inline dialogs inside their
 * respective surfaces — this page exists for the "I just need to track
 * a task" case (matches SafetyCulture's "+ Create action" top-right).
 *
 * If the tenant has any active action types, the user picks one first.
 * Picking a type unlocks the type's custom questions and may make
 * built-in fields (assignee, due date, …) required. The list of types
 * also includes a "(none)" option for backward-compat — tenants that
 * haven't configured any types can still create plain actions.
 */
export default function NewActionPage() {
  const t = useTranslations('actions.create');
  const { label: placeLabel } = usePlaceTerms();
  const tType = useTranslations('actions.create.type');
  const tPriority = useTranslations('actions.priority');
  const tCommon = useTranslations('common');
  const onServerError = useServerErrorToast(tCommon('error'));
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();
  const searchParams = useSearchParams();

  const canCreate = useHasPermission('actions.create');
  useEffect(() => {
    if (!canCreate) {
      toast.error(tCommon('error'));
      router.push(`/${locale}/actions`);
    }
  }, [canCreate, locale, router, tCommon]);

  const [actionTypeId, setActionTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('low');
  const [dueAt, setDueAt] = useState('');
  // Pre-fill from ?site= — the "create here" flow from a project page.
  // useSearchParams (not window.location) so client-side navigations see
  // the destination URL on first render.
  const [siteId, setSiteId] = useState<string>(() => searchParams.get('site') ?? '');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [label, setLabel] = useState('');
  const [customResponses, setCustomResponses] = useState<Record<string, unknown>>({});
  // Pre-select from ?asset= — the "raise an action" flow from an asset page.
  // The picker below still shows it ticked, so it can be changed or cleared;
  // this only saves the user finding the asset they were just looking at.
  const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(() => {
    const fromQuery = searchParams.get('asset');
    return fromQuery !== null && fromQuery !== '' ? new Set([fromQuery]) : new Set();
  });

  const { data: types } = trpc.actionTypes.list.useQuery({ includeArchived: false });
  const { data: assetsList } = trpc.assets.listWithChildren.useQuery();
  const { data: actionSettings } = trpc.actionTypes.settings.get.useQuery();

  // Track whether the current dueAt value was auto-computed from the priority
  // so we can update it transparently when the user changes priority, but
  // respect any date the user typed themselves.
  const [dueAtAutoSet, setDueAtAutoSet] = useState(false);

  // When actionSettings first loads, auto-set the due date for the default
  // priority ('low') so the field isn't left blank on page load.
  useEffect(() => {
    if (dueAt !== '' || actionSettings === undefined) return;
    const days = actionSettings.priorityDueDateDays['low'] ?? 30;
    if (days > 0) {
      const d = new Date(Date.now() + days * 86_400_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      setDueAt(
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
      );
      setDueAtAutoSet(true);
    }
  }, [actionSettings]);

  const selectedType = useMemo(
    () => (types ?? []).find((tp) => tp.id === actionTypeId) ?? null,
    [types, actionTypeId],
  );

  // When the tenant has at least one type and none is selected yet,
  // default to the first type flagged as the default (if any).
  useEffect(() => {
    if (actionTypeId !== '') return;
    if (!types || types.length === 0) return;
    const fallback = types.find((tp) => tp.isDefault) ?? null;
    if (fallback !== null) setActionTypeId(fallback.id);
  }, [types, actionTypeId]);

  // Reset custom responses and label when the type changes (the new type
  // may have a different labels list, so stale free-text or a label from
  // a different type's list would be confusing to see pre-filled).
  useEffect(() => {
    setCustomResponses({});
    setLabel('');
  }, [actionTypeId]);

  const required = selectedType?.requiredFields ?? [];
  const isRequired = (
    field: 'description' | 'assignee' | 'priority' | 'dueDate' | 'site',
  ): boolean => required.includes(field);

  const customResponsesValid = useMemo(() => {
    if (selectedType === null) return true;
    for (const q of selectedType.customQuestions) {
      if (!q.required) continue;
      const v = customResponses[q.id];
      if (v === undefined || v === null) return false;
      if (typeof v === 'string' && v.trim() === '') return false;
    }
    return true;
  }, [selectedType, customResponses]);

  const requiredFieldsValid =
    (!isRequired('description') || description.trim() !== '') &&
    (!isRequired('dueDate') || dueAt !== '') &&
    (!isRequired('site') || siteId !== '') &&
    (!isRequired('assignee') || assigneeUserId !== '');

  const create = trpc.actions.createStandalone.useMutation({
    onSuccess: (result) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/actions/${result.actionId}`);
    },
    onError: onServerError,
  });

  const canSubmit =
    title.trim().length > 0 && !create.isPending && customResponsesValid && requiredFieldsValid;

  function onSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!canSubmit) return;
    const input: {
      title: string;
      description?: string;
      priority?: Priority;
      dueAt?: string;
      assigneeUserId?: string;
      siteId?: string;
      label?: string;
      actionTypeId?: string;
      customQuestionResponses?: Record<string, unknown>;
      assetIds?: string[];
    } = { title: title.trim() };
    if (description.trim().length > 0) input.description = description.trim();
    input.priority = priority;
    if (dueAt !== '') input.dueAt = new Date(dueAt).toISOString();
    if (assigneeUserId !== '') input.assigneeUserId = assigneeUserId;
    if (siteId !== '') input.siteId = siteId;
    if (label.trim().length > 0) input.label = label.trim();
    if (actionTypeId !== '') {
      input.actionTypeId = actionTypeId;
      if (selectedType !== null && selectedType.customQuestions.length > 0) {
        input.customQuestionResponses = customResponses;
      }
    }
    if (selectedAssetIds.size > 0) input.assetIds = [...selectedAssetIds];
    create.mutate(input);
  }

  return (
    <FocusedPageShell title={t('title')} backHref={`/${locale}/actions`} width="form">
      <Card className="max-w-2xl">
        <CardContent className="space-y-4 py-6">
          <form onSubmit={onSubmit} className="space-y-4">
            {types !== undefined && types.length > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="action-type">{tType('label')}</Label>
                <select
                  id="action-type"
                  value={actionTypeId}
                  onChange={(e) => setActionTypeId(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{tType('none')}</option>
                  {types.map((tp) => (
                    <option key={tp.id} value={tp.id}>
                      {tp.name}
                      {tp.isDefault ? ` (${tType('defaultSuffix')})` : ''}
                    </option>
                  ))}
                </select>
                {selectedType !== null && selectedType.description !== null ? (
                  <p className="text-xs text-muted-foreground">{selectedType.description}</p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="title">
                {t('titleLabel')}
                <span className="ml-1 text-destructive">*</span>
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('titlePlaceholder')}
                maxLength={500}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">
                {t('descriptionLabel')}
                {isRequired('description') ? (
                  <span className="ml-1 text-destructive">*</span>
                ) : null}
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
                rows={4}
                maxLength={20_000}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="priority">
                  {t('priorityLabel')}
                  {isRequired('priority') ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => {
                    const next = e.target.value as Priority;
                    setPriority(next);
                    // Auto-compute due date from priority unless the user has set one manually.
                    if (dueAtAutoSet || dueAt === '') {
                      const days =
                        actionSettings?.priorityDueDateDays[next] ??
                        { low: 30, medium: 7, high: 1, critical: 1 }[next];
                      if (days !== null && days !== undefined && days > 0) {
                        const d = new Date(Date.now() + days * 86_400_000);
                        const pad = (n: number) => String(n).padStart(2, '0');
                        setDueAt(
                          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
                        );
                        setDueAtAutoSet(true);
                      }
                    }
                  }}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {tPriority(p)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dueAt">
                  {t('dueDateLabel')}
                  {isRequired('dueDate') ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
                <Input
                  id="dueAt"
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => {
                    setDueAt(e.target.value);
                    setDueAtAutoSet(false);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="site">
                  {placeLabel}
                  {isRequired('site') ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
                <SiteSelector
                  value={siteId !== '' ? [siteId] : []}
                  onChange={(next) => setSiteId(next[0] ?? '')}
                  multiple={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assignee">
                  {t('assigneeLabel')}
                  {isRequired('assignee') ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
                <GroupUserSelector
                  mode="users"
                  multiple={false}
                  value={assigneeUserId !== '' ? [assigneeUserId] : []}
                  onChange={(next) => setAssigneeUserId(next[0] ?? '')}
                />
              </div>
            </div>
            {(selectedType === null || selectedType.labels.length > 0) && (
              <div className="space-y-1.5">
                <Label htmlFor="label">{t('labelLabel')}</Label>
                {selectedType !== null && selectedType.labels.length > 0 ? (
                  <select
                    id="label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">{t('labelNoneOption')}</option>
                    {selectedType.labels.map((lbl) => (
                      <option key={lbl} value={lbl}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id="label"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={t('labelPlaceholder')}
                    maxLength={80}
                  />
                )}
              </div>
            )}

            {selectedType !== null && selectedType.customQuestions.length > 0 ? (
              <CustomQuestionsForm
                questions={[...selectedType.customQuestions]}
                responses={customResponses}
                onChange={setCustomResponses}
              />
            ) : null}

            {assetsList !== undefined && assetsList.length > 0 ? (
              <div className="space-y-1.5">
                <Label>{t('assetsLabel')}</Label>
                <InlineAssetPicker
                  parents={assetsList}
                  selectedIds={selectedAssetIds}
                  onChange={setSelectedAssetIds}
                />
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={!canSubmit}>
                {t('saveButton')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </FocusedPageShell>
  );
}

/**
 * Renders the action type's custom-question form. Mirrors the shape
 * the server validates (`validateCustomResponses` in the actions
 * router): text → string, number → number, multipleChoice → option
 * string. Required questions show an asterisk; the parent component
 * blocks submit until every required answer is filled.
 */
function CustomQuestionsForm({
  questions,
  responses,
  onChange,
}: {
  questions: ActionCustomQuestion[];
  responses: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const t = useTranslations('actions.create.questions');

  function update(id: string, value: unknown): void {
    onChange({ ...responses, [id]: value });
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-4">
      <h3 className="text-sm font-medium">{t('heading')}</h3>
      {questions.map((q) => (
        <div key={q.id} className="space-y-1.5">
          <Label htmlFor={`q-${q.id}`}>
            {q.prompt}
            {q.required ? <span className="ml-1 text-destructive">*</span> : null}
          </Label>
          {q.type === 'text' ? (
            <Textarea
              id={`q-${q.id}`}
              value={typeof responses[q.id] === 'string' ? (responses[q.id] as string) : ''}
              onChange={(e) => update(q.id, e.target.value)}
              rows={2}
              maxLength={2000}
            />
          ) : q.type === 'number' ? (
            <Input
              id={`q-${q.id}`}
              type="number"
              value={
                typeof responses[q.id] === 'number'
                  ? String(responses[q.id])
                  : typeof responses[q.id] === 'string'
                    ? (responses[q.id] as string)
                    : ''
              }
              onChange={(e) => update(q.id, e.target.value === '' ? '' : Number(e.target.value))}
            />
          ) : (
            <select
              id={`q-${q.id}`}
              value={typeof responses[q.id] === 'string' ? (responses[q.id] as string) : ''}
              onChange={(e) => update(q.id, e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">{t('selectPlaceholder')}</option>
              {(q.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )}
        </div>
      ))}
    </div>
  );
}

type ParentAsset = {
  id: string;
  name: string;
  parentId: string | null;
  typeId: string | null;
  typeName: string | null;
  children: Array<{
    id: string;
    name: string;
    parentId: string | null;
    typeId: string | null;
    typeName: string | null;
  }>;
};

function InlineAssetPicker({
  parents,
  selectedIds,
  onChange,
}: {
  parents: ParentAsset[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  // A sub-asset arriving pre-selected (?asset=) sits inside a collapsed
  // parent, where the only sign of it is the parent's indeterminate tick.
  // Open the groups that hold one so the selection is visible.
  const [expanded, setExpanded] = useState<Set<string>>(
    () =>
      new Set(
        parents.filter((p) => p.children.some((c) => selectedIds.has(c.id))).map((p) => p.id),
      ),
  );

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleParent(parent: ParentAsset) {
    const next = new Set(selectedIds);
    const allChildIds = parent.children.map((c) => c.id);
    const allSelected =
      selectedIds.has(parent.id) && allChildIds.every((cid) => selectedIds.has(cid));
    if (allSelected) {
      next.delete(parent.id);
      for (const cid of allChildIds) next.delete(cid);
    } else {
      next.add(parent.id);
      for (const cid of allChildIds) next.add(cid);
    }
    onChange(next);
  }

  function toggleChild(childId: string) {
    const next = new Set(selectedIds);
    if (next.has(childId)) next.delete(childId);
    else next.add(childId);
    onChange(next);
  }

  function parentCheckState(parent: ParentAsset): boolean | 'indeterminate' {
    const allChildIds = parent.children.map((c) => c.id);
    const parentChecked = selectedIds.has(parent.id);
    if (allChildIds.length === 0) return parentChecked;
    const checkedCount = allChildIds.filter((cid) => selectedIds.has(cid)).length;
    if (!parentChecked && checkedCount === 0) return false;
    if (parentChecked && checkedCount === allChildIds.length) return true;
    return 'indeterminate';
  }

  return (
    <div className="space-y-1 rounded-md border bg-background p-2">
      {parents.map((parent) => {
        const isExpanded = expanded.has(parent.id);
        const cs = parentCheckState(parent);
        return (
          <div key={parent.id}>
            <div className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50">
              <Checkbox
                checked={cs === true}
                data-state={cs === 'indeterminate' ? 'indeterminate' : undefined}
                onCheckedChange={() => toggleParent(parent)}
                aria-label={parent.name}
              />
              <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm font-medium">{parent.name}</span>
              {parent.children.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggleExpand(parent.id)}
                  className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight
                    className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                  />
                  <span>{parent.children.length}</span>
                </button>
              )}
            </div>
            {isExpanded && parent.children.length > 0 && (
              <div className="ml-6 space-y-0.5 border-l pl-3 pt-0.5">
                {parent.children.map((child) => (
                  <div
                    key={child.id}
                    className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedIds.has(child.id)}
                      onCheckedChange={() => toggleChild(child.id)}
                      aria-label={child.name}
                    />
                    <span className="text-sm">{child.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
