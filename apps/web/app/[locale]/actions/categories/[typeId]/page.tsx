'use client';

import type {
  ActionCustomQuestion,
  ActionLabels,
  ActionRequiredField,
  ActionVisibilityRule,
  TransitionRules,
} from '@forma360/shared/actions-schema';
import { ACTION_REQUIRED_FIELDS, ACTION_VISIBILITY_RULES } from '@forma360/shared/actions-schema';
import { newId } from '@forma360/shared/id';
import { ChevronLeft, Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../../src/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../src/components/ui/card';
import { Input } from '../../../../../src/components/ui/input';
import { Label } from '../../../../../src/components/ui/label';
import { Skeleton } from '../../../../../src/components/ui/skeleton';
import { Switch } from '../../../../../src/components/ui/switch';
import { Textarea } from '../../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../../src/lib/permissions-context';
import { trpc } from '../../../../../src/lib/trpc/client';

const MAX_QUESTIONS = 20;
const MAX_OPTIONS = 20;
const MAX_LABELS = 50;
const MAX_LABEL_TEXT = 80;
const MAX_PROMPT = 500;
const MAX_OPTION_TEXT = 200;

/**
 * Action type detail page — accessed from Actions → Categories.
 *
 * Five cards on one page (matches SafetyCulture's layout for action
 * type detail):
 *   1. Basics       — name / description / colour.
 *   2. Custom questions — text / number / multiple-choice prompts that
 *                          the reporter answers when creating an action.
 *   3. Required fields — which built-in fields the type forces.
 *   4. Visibility   — who can see actions of this type.
 *   5. Transition rules — which groups can move the action into a gated
 *                         terminal status (`completed` / `cancelled`).
 *
 * One save button drives the entire form. The local draft state is
 * seeded from the server on first load and reset back to clean after a
 * successful save.
 */
export default function ActionTypeDetailPage() {
  const t = useTranslations('actionTypeDetail');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string; typeId: string }>();
  const locale = params.locale ?? 'en';
  const typeId = params.typeId ?? '';
  const router = useRouter();
  const utils = trpc.useUtils();
  const canSettings = useHasPermission('actions.settings');

  const { data: type, isLoading, error } = trpc.actionTypes.get.useQuery({ typeId });
  const { data: groups } = trpc.groups.list.useQuery();

  const update = trpc.actionTypes.update.useMutation({
    onSuccess: () => {
      toast.success(t('savedToast'));
      void utils.actionTypes.get.invalidate({ typeId });
      void utils.actionTypes.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  // Local draft state — seeded from server data on first arrival.
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#2563eb');
  const [questions, setQuestions] = useState<ActionCustomQuestion[]>([]);
  const [requiredFields, setRequiredFields] = useState<ActionRequiredField[]>([]);
  const [labels, setLabels] = useState<ActionLabels>([]);
  const [visibility, setVisibility] = useState<ActionVisibilityRule>('all_users');
  const [transitionRules, setTransitionRules] = useState<TransitionRules>({
    completed: { allowedGroupIds: [] },
    cancelled: { allowedGroupIds: [] },
  });
  const [seeded, setSeeded] = useState(false);

  useEffect(() => {
    if (type === undefined || seeded) return;
    setName(type.name);
    setDescription(type.description ?? '');
    setColor(type.color ?? '#2563eb');
    // Spread to drop readonly modifiers from the inferred query result.
    setQuestions([...type.customQuestions]);
    setRequiredFields([...type.requiredFields]);
    setLabels([...type.labels]);
    setVisibility(type.visibility);
    setTransitionRules({
      completed: { allowedGroupIds: [...type.transitionRules.completed.allowedGroupIds] },
      cancelled: { allowedGroupIds: [...type.transitionRules.cancelled.allowedGroupIds] },
    });
    setSeeded(true);
  }, [type, seeded]);

  const dirty = useMemo(() => {
    if (type === undefined) return false;
    if (name.trim() !== type.name) return true;
    if ((description.trim() === '' ? null : description.trim()) !== (type.description ?? null))
      return true;
    if ((color === '' ? null : color) !== (type.color ?? null)) return true;
    if (JSON.stringify(questions) !== JSON.stringify(type.customQuestions)) return true;
    if (
      JSON.stringify(requiredFields.slice().sort()) !==
      JSON.stringify(type.requiredFields.slice().sort())
    )
      return true;
    if (JSON.stringify(labels) !== JSON.stringify(type.labels)) return true;
    if (visibility !== type.visibility) return true;
    if (JSON.stringify(transitionRules) !== JSON.stringify(type.transitionRules)) return true;
    return false;
  }, [
    type,
    name,
    description,
    color,
    questions,
    requiredFields,
    labels,
    visibility,
    transitionRules,
  ]);

  const questionsValid = useMemo(() => customQuestionsAreValid(questions), [questions]);
  const canSave =
    canSettings && dirty && name.trim().length > 0 && questionsValid && !update.isPending;

  function onSave() {
    if (!canSave) return;
    update.mutate({
      typeId,
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      color: color === '' ? null : color,
      customQuestions: normaliseCustomQuestions(questions),
      requiredFields,
      labels,
      visibility,
      transitionRules,
    });
  }

  if (error !== null && error !== undefined) {
    return (
      <div className="space-y-4">
        <Link
          href={`/${locale}/actions/categories`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {t('backLink')}
        </Link>
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{error.message}</CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || type === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="-mx-4 -my-6 flex flex-1 flex-col bg-[#eef4fb] px-4 py-6 dark:bg-slate-900/40 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto w-full max-w-[1200px] space-y-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link
              href={`/${locale}/actions/categories`}
              className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t('backLink')}
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">{type.name}</h1>
            {type.archivedAt !== null ? (
              <p className="mt-1 text-sm text-muted-foreground">{t('archivedNotice')}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {dirty ? (
              <Button
                type="button"
                variant="ghost"
                disabled={update.isPending}
                onClick={() => {
                  setSeeded(false);
                }}
              >
                {tCommon('cancel')}
              </Button>
            ) : null}
            <Button type="button" disabled={!canSave} onClick={onSave}>
              {tCommon('save')}
            </Button>
          </div>
        </div>

        {/* Basics */}
        <Card>
          <CardHeader>
            <CardTitle>{t('basics.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-name">{t('basics.nameLabel')}</Label>
              <Input
                id="t-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                disabled={!canSettings}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-desc">{t('basics.descriptionLabel')}</Label>
              <Textarea
                id="t-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={3}
                disabled={!canSettings}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="t-color">{t('basics.colorLabel')}</Label>
              <Input
                id="t-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-20 p-1"
                disabled={!canSettings}
              />
            </div>
          </CardContent>
        </Card>

        {/* Custom questions */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>{t('questions.title')}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t('questions.subtitle')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (questions.length >= MAX_QUESTIONS) return;
                  setQuestions((prev) => [
                    ...prev,
                    { id: newId(), prompt: '', type: 'text', required: false },
                  ]);
                }}
                disabled={!canSettings || questions.length >= MAX_QUESTIONS}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('questions.addButton')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('questions.empty')}</p>
            ) : (
              <div className="space-y-3">
                {questions.map((q, i) => (
                  <QuestionRow
                    key={q.id}
                    question={q}
                    disabled={!canSettings}
                    onChange={(patch) =>
                      setQuestions((prev) => {
                        const list = prev.slice();
                        const current = list[i];
                        if (current === undefined) return prev;
                        const merged: ActionCustomQuestion = { ...current, ...patch };
                        if (
                          merged.type === 'multipleChoice' &&
                          (merged.options === undefined || merged.options.length === 0)
                        ) {
                          merged.options = [''];
                        }
                        if (merged.type !== 'multipleChoice') {
                          delete merged.options;
                        }
                        list[i] = merged;
                        return list;
                      })
                    }
                    onRemove={() =>
                      setQuestions((prev) => {
                        const list = prev.slice();
                        list.splice(i, 1);
                        return list;
                      })
                    }
                  />
                ))}
                <p className="text-xs text-muted-foreground">
                  {t('questions.counter', { count: questions.length, max: MAX_QUESTIONS })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Required fields */}
        <Card>
          <CardHeader>
            <CardTitle>{t('required.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('required.subtitle')}</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {ACTION_REQUIRED_FIELDS.map((field) => {
                const checked = requiredFields.includes(field);
                return (
                  <label
                    key={field}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-md border bg-card p-3"
                  >
                    <span className="text-sm">{t(`required.fields.${field}`)}</span>
                    <Switch
                      checked={checked}
                      onCheckedChange={(v) => {
                        setRequiredFields((prev) => {
                          if (v) return prev.includes(field) ? prev : [...prev, field];
                          return prev.filter((f) => f !== field);
                        });
                      }}
                      disabled={!canSettings}
                    />
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Labels */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>{t('labels.title')}</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">{t('labels.subtitle')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (labels.length >= MAX_LABELS) return;
                  setLabels((prev) => [...prev, '']);
                }}
                disabled={!canSettings || labels.length >= MAX_LABELS}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('labels.addButton')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {labels.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('labels.empty')}</p>
            ) : (
              <div className="space-y-2">
                {labels.map((lbl, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={lbl}
                      onChange={(e) =>
                        setLabels((prev) => {
                          const next = prev.slice();
                          next[i] = e.target.value;
                          return next;
                        })
                      }
                      placeholder={t('labels.placeholder')}
                      maxLength={MAX_LABEL_TEXT}
                      disabled={!canSettings}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setLabels((prev) => {
                          const next = prev.slice();
                          next.splice(i, 1);
                          return next;
                        })
                      }
                      disabled={!canSettings}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {t('labels.counter', { count: labels.length, max: MAX_LABELS })}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Visibility */}
        <Card>
          <CardHeader>
            <CardTitle>{t('visibility.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('visibility.subtitle')}</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ACTION_VISIBILITY_RULES.map((rule) => (
                <label
                  key={rule}
                  className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3"
                >
                  <input
                    type="radio"
                    name="visibility"
                    value={rule}
                    checked={visibility === rule}
                    onChange={() => setVisibility(rule)}
                    disabled={!canSettings}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-medium">
                      {t(`visibility.options.${rule}.label`)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t(`visibility.options.${rule}.help`)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Transition rules */}
        <Card>
          <CardHeader>
            <CardTitle>{t('transitions.title')}</CardTitle>
            <p className="text-sm text-muted-foreground">{t('transitions.subtitle')}</p>
          </CardHeader>
          <CardContent className="space-y-6">
            {(['completed', 'cancelled'] as const).map((status) => (
              <TransitionPicker
                key={status}
                status={status}
                groups={groups ?? []}
                allowedGroupIds={transitionRules[status].allowedGroupIds}
                disabled={!canSettings}
                onChange={(ids) =>
                  setTransitionRules((prev) => ({
                    ...prev,
                    [status]: { allowedGroupIds: ids },
                  }))
                }
              />
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 pb-8">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push(`/${locale}/actions/categories`)}
          >
            {t('done')}
          </Button>
          <Button type="button" disabled={!canSave} onClick={onSave}>
            {tCommon('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function QuestionRow({
  question,
  disabled,
  onChange,
  onRemove,
}: {
  question: ActionCustomQuestion;
  disabled: boolean;
  onChange: (patch: Partial<ActionCustomQuestion>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('actionTypeDetail.questions');
  const promptInvalid = question.prompt.trim().length === 0;
  const options = question.options ?? [];
  const optionsInvalid =
    question.type === 'multipleChoice' &&
    (options.length === 0 || options.some((o) => o.trim().length === 0));

  function updateOption(oi: number, value: string) {
    const next = options.slice();
    next[oi] = value;
    onChange({ options: next });
  }

  function addOption() {
    if (options.length >= MAX_OPTIONS) return;
    onChange({ options: [...options, ''] });
  }

  function removeOption(oi: number) {
    if (options.length <= 1) return;
    const next = options.slice();
    next.splice(oi, 1);
    onChange({ options: next });
  }

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="w-36 shrink-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('typeLabel')}</Label>
          <select
            value={question.type}
            onChange={(e) => onChange({ type: e.target.value as ActionCustomQuestion['type'] })}
            disabled={disabled}
            className="block w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="text">{t('types.text')}</option>
            <option value="number">{t('types.number')}</option>
            <option value="multipleChoice">{t('types.multipleChoice')}</option>
          </select>
        </div>
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t('promptLabel')}</Label>
          <Input
            value={question.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            placeholder={t('promptPlaceholder')}
            maxLength={MAX_PROMPT}
            disabled={disabled}
          />
          {promptInvalid ? (
            <p className="text-xs text-destructive">{t('validationPromptEmpty')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2 pt-6">
          <div className="flex items-center gap-1">
            <Switch
              checked={question.required}
              onCheckedChange={(v) => onChange({ required: v })}
              disabled={disabled}
            />
            <span className="text-xs text-muted-foreground">{t('requiredLabel')}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('removeButton')}
          className="mt-5 text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      {question.type === 'multipleChoice' ? (
        <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-3">
          <Label className="text-xs text-muted-foreground">{t('choicesLabel')}</Label>
          <div className="space-y-2">
            {options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <Input
                  value={opt}
                  onChange={(e) => updateOption(oi, e.target.value)}
                  placeholder={t('choicePlaceholder')}
                  maxLength={MAX_OPTION_TEXT}
                  disabled={disabled}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeOption(oi)}
                  disabled={disabled || options.length <= 1}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addOption}
              disabled={disabled || options.length >= MAX_OPTIONS}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('addChoiceButton')}
            </Button>
            {optionsInvalid ? (
              <span className="text-xs text-destructive">{t('validationOptionsEmpty')}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TransitionPicker({
  status,
  groups,
  allowedGroupIds,
  disabled,
  onChange,
}: {
  status: 'completed' | 'cancelled';
  groups: { id: string; name: string }[];
  allowedGroupIds: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const t = useTranslations('actionTypeDetail.transitions');
  const anyone = allowedGroupIds.length === 0;
  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{t(`status.${status}`)}</div>
          <div className="text-xs text-muted-foreground">
            {anyone ? t('anyoneHelp') : t('groupsHelp', { count: allowedGroupIds.length })}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noGroups')}</p>
        ) : (
          groups.map((g) => {
            const checked = allowedGroupIds.includes(g.id);
            return (
              <label
                key={g.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) {
                      onChange([...allowedGroupIds, g.id]);
                    } else {
                      onChange(allowedGroupIds.filter((id) => id !== g.id));
                    }
                  }}
                  disabled={disabled}
                  className="h-4 w-4"
                />
                <span>{g.name}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function normaliseCustomQuestions(questions: ActionCustomQuestion[]): ActionCustomQuestion[] {
  return questions.map((q) => {
    const base: ActionCustomQuestion = {
      id: q.id,
      prompt: q.prompt.trim(),
      type: q.type,
      required: q.required,
    };
    if (q.type === 'multipleChoice') {
      base.options = (q.options ?? []).map((o) => o.trim());
    }
    return base;
  });
}

function customQuestionsAreValid(questions: ActionCustomQuestion[]): boolean {
  if (questions.length > MAX_QUESTIONS) return false;
  for (const q of questions) {
    const prompt = q.prompt.trim();
    if (prompt.length === 0 || prompt.length > MAX_PROMPT) return false;
    if (q.type === 'multipleChoice') {
      const opts = q.options ?? [];
      if (opts.length === 0) return false;
      for (const opt of opts) {
        const trimmed = opt.trim();
        if (trimmed.length === 0 || trimmed.length > MAX_OPTION_TEXT) return false;
      }
    }
  }
  return true;
}
