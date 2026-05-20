'use client';

import type { ActionCustomQuestion } from '@forma360/shared/actions-schema';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

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
  const tType = useTranslations('actions.create.type');
  const tPriority = useTranslations('actions.priority');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const router = useRouter();

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
  const [priority, setPriority] = useState<'' | Priority>('');
  const [dueAt, setDueAt] = useState('');
  const [siteId, setSiteId] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [label, setLabel] = useState('');
  const [customResponses, setCustomResponses] = useState<Record<string, unknown>>({});

  const { data: sites } = trpc.sites.list.useQuery();
  const { data: usersData } = trpc.users.list.useQuery({});
  const users = usersData?.users ?? [];
  const { data: types } = trpc.actionTypes.list.useQuery({ includeArchived: false });

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

  // Reset custom responses when the type changes.
  useEffect(() => {
    setCustomResponses({});
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
    (!isRequired('priority') || priority !== '') &&
    (!isRequired('dueDate') || dueAt !== '') &&
    (!isRequired('site') || siteId !== '') &&
    (!isRequired('assignee') || assigneeUserId !== '');

  const create = trpc.actions.createStandalone.useMutation({
    onSuccess: (result) => {
      toast.success(t('createdToast'));
      router.push(`/${locale}/actions/${result.actionId}`);
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
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
    } = { title: title.trim() };
    if (description.trim().length > 0) input.description = description.trim();
    if (priority !== '') input.priority = priority;
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
                  onChange={(e) => setPriority(e.target.value as '' | Priority)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('noPriority')}</option>
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
                  onChange={(e) => setDueAt(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="site">
                  {t('siteLabel')}
                  {isRequired('site') ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
                <select
                  id="site"
                  value={siteId}
                  onChange={(e) => setSiteId(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">{t('siteNoneOption')}</option>
                  {(sites ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="assignee">
                  {t('assigneeLabel')}
                  {isRequired('assignee') ? <span className="ml-1 text-destructive">*</span> : null}
                </Label>
                <select
                  id="assignee"
                  value={assigneeUserId}
                  onChange={(e) => setAssigneeUserId(e.target.value)}
                  className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="label">{t('labelLabel')}</Label>
              <Input
                id="label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t('labelPlaceholder')}
                maxLength={80}
              />
            </div>

            {selectedType !== null && selectedType.customQuestions.length > 0 ? (
              <CustomQuestionsForm
                questions={[...selectedType.customQuestions]}
                responses={customResponses}
                onChange={setCustomResponses}
              />
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
