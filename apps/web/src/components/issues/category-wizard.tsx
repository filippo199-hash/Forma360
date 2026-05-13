'use client';

import type {
  IssueCustomQuestion,
  IssueNotificationRule,
} from '@forma360/shared/issues-schema';
import { newId } from '@forma360/shared/id';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';

const NOTIFICATION_RULES: readonly IssueNotificationRule[] = [
  'private',
  'summary',
  'detailed',
];

const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 20;
const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const MAX_PROMPT = 500;
const MAX_OPTION_TEXT = 200;

export interface CategoryWizardValues {
  name: string;
  description: string;
  notificationRule: IssueNotificationRule;
  criticalAlerts: boolean;
  accessRuleId: string;
  customQuestions: IssueCustomQuestion[];
}

export interface CategoryWizardSubmit {
  name: string;
  description: string;
  notificationRule: IssueNotificationRule;
  criticalAlerts: boolean;
  accessRuleId: string;
  customQuestions: IssueCustomQuestion[];
}

interface CategoryWizardProps {
  mode: 'create' | 'edit';
  defaultValues: CategoryWizardValues;
  accessRules: ReadonlyArray<{ id: string; name: string }>;
  submitting: boolean;
  onSave: (values: CategoryWizardSubmit) => void;
  onCancel: () => void;
}

type Step = 1 | 2 | 3;

export const EMPTY_CATEGORY_WIZARD_VALUES: CategoryWizardValues = {
  name: '',
  description: '',
  notificationRule: 'summary',
  criticalAlerts: false,
  accessRuleId: '',
  customQuestions: [],
};

/**
 * Three-step wizard for creating / editing an issue category.
 *
 * Step 1: Basics (name + description).
 * Step 2: Custom-questions builder (text + multipleChoice questions).
 * Step 3: Access rule + notification settings.
 *
 * The wizard intentionally omits the linked-templates field (deferred)
 * and the legacy custom-fields editor; both stay in the schema and are
 * sent as empty arrays from the page-level save handler.
 */
export function CategoryWizard({
  mode: _mode,
  defaultValues,
  accessRules,
  submitting,
  onSave,
  onCancel,
}: CategoryWizardProps) {
  const t = useTranslations('issues.categories');
  const tQ = useTranslations('issues.categories.questionBuilder');

  const [step, setStep] = useState<Step>(1);
  const [values, setValues] = useState<CategoryWizardValues>(defaultValues);

  const step1Valid = useMemo(() => values.name.trim().length > 0, [values.name]);
  const step2Valid = useMemo(() => {
    if (values.customQuestions.length > MAX_QUESTIONS) return false;
    for (const q of values.customQuestions) {
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
  }, [values.customQuestions]);

  const nextEnabled = step === 1 ? step1Valid : step === 2 ? step2Valid : true;

  function goNext() {
    if (!nextEnabled) return;
    if (step === 1) setStep(2);
    else if (step === 2) setStep(3);
  }

  function goBack() {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  }

  function handleSave() {
    if (!step1Valid || !step2Valid || submitting) return;
    // Normalise: trim prompts & options, drop empties on text-only questions.
    const normalisedQuestions: IssueCustomQuestion[] = values.customQuestions.map(
      (q) => {
        const base: IssueCustomQuestion = {
          id: q.id,
          prompt: q.prompt.trim(),
          type: q.type,
          required: q.required,
        };
        if (q.type === 'multipleChoice') {
          base.options = (q.options ?? []).map((o) => o.trim());
        }
        return base;
      },
    );
    onSave({
      name: values.name.trim(),
      description: values.description.trim(),
      notificationRule: values.notificationRule,
      criticalAlerts: values.criticalAlerts,
      accessRuleId: values.accessRuleId,
      customQuestions: normalisedQuestions,
    });
  }

  function addQuestion() {
    if (values.customQuestions.length >= MAX_QUESTIONS) return;
    const next: IssueCustomQuestion = {
      id: newId(),
      prompt: '',
      type: 'text',
      required: false,
    };
    setValues({ ...values, customQuestions: [...values.customQuestions, next] });
  }

  function updateQuestion(index: number, patch: Partial<IssueCustomQuestion>) {
    const list = values.customQuestions.slice();
    const current = list[index];
    if (current === undefined) return;
    const merged: IssueCustomQuestion = { ...current, ...patch };
    // When switching to multipleChoice without options, seed an empty one
    // so the validation prompt has something to attach to.
    if (merged.type === 'multipleChoice' && (merged.options === undefined || merged.options.length === 0)) {
      merged.options = [''];
    }
    // When switching back to text, drop options entirely.
    if (merged.type === 'text') {
      delete merged.options;
    }
    list[index] = merged;
    setValues({ ...values, customQuestions: list });
  }

  function removeQuestion(index: number) {
    const list = values.customQuestions.slice();
    list.splice(index, 1);
    setValues({ ...values, customQuestions: list });
  }

  function addOption(qIndex: number) {
    const list = values.customQuestions.slice();
    const current = list[qIndex];
    if (current === undefined || current.type !== 'multipleChoice') return;
    const opts = (current.options ?? []).slice();
    if (opts.length >= MAX_OPTIONS) return;
    opts.push('');
    list[qIndex] = { ...current, options: opts };
    setValues({ ...values, customQuestions: list });
  }

  function updateOption(qIndex: number, oIndex: number, value: string) {
    const list = values.customQuestions.slice();
    const current = list[qIndex];
    if (current === undefined || current.type !== 'multipleChoice') return;
    const opts = (current.options ?? []).slice();
    if (opts[oIndex] === undefined) return;
    opts[oIndex] = value;
    list[qIndex] = { ...current, options: opts };
    setValues({ ...values, customQuestions: list });
  }

  function removeOption(qIndex: number, oIndex: number) {
    const list = values.customQuestions.slice();
    const current = list[qIndex];
    if (current === undefined || current.type !== 'multipleChoice') return;
    const opts = (current.options ?? []).slice();
    if (opts.length <= 1) return;
    opts.splice(oIndex, 1);
    list[qIndex] = { ...current, options: opts };
    setValues({ ...values, customQuestions: list });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {step === 1
            ? t('step1Title')
            : step === 2
              ? tQ('title')
              : t('step3Title')}
        </DialogTitle>
        <DialogDescription>
          {step === 1
            ? t('step1Subtitle')
            : step === 2
              ? tQ('subtitle')
              : t('step3Subtitle')}
        </DialogDescription>
      </DialogHeader>

      <Stepper step={step} />

      <div className="space-y-4">
        {step === 1 ? (
          <StepBasics
            name={values.name}
            description={values.description}
            onNameChange={(name) => setValues({ ...values, name })}
            onDescriptionChange={(description) => setValues({ ...values, description })}
          />
        ) : null}

        {step === 2 ? (
          <StepQuestions
            questions={values.customQuestions}
            addQuestion={addQuestion}
            updateQuestion={updateQuestion}
            removeQuestion={removeQuestion}
            addOption={addOption}
            updateOption={updateOption}
            removeOption={removeOption}
          />
        ) : null}

        {step === 3 ? (
          <StepAccess
            notificationRule={values.notificationRule}
            criticalAlerts={values.criticalAlerts}
            accessRuleId={values.accessRuleId}
            accessRules={accessRules}
            onChange={(patch) => setValues({ ...values, ...patch })}
          />
        ) : null}
      </div>

      <DialogFooter>
        {step === 1 ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('cancelButton')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" onClick={goBack}>
            {t('wizardBack')}
          </Button>
        )}
        {step < 3 ? (
          <Button type="button" onClick={goNext} disabled={!nextEnabled}>
            {t('wizardNext')}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleSave}
            disabled={submitting || !step1Valid || !step2Valid}
          >
            {t('wizardSave')}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}

function Stepper({ step }: { step: Step }) {
  const t = useTranslations('issues.categories.wizardSteps');
  const labels: Array<{ n: Step; key: 'basics' | 'questions' | 'access' }> = [
    { n: 1, key: 'basics' },
    { n: 2, key: 'questions' },
    { n: 3, key: 'access' },
  ];
  return (
    <div className="flex items-center gap-3 text-xs">
      {labels.map((l, i) => (
        <div key={l.key} className="flex items-center gap-3">
          <span
            className={
              l.n === step
                ? 'font-medium text-foreground'
                : 'text-muted-foreground'
            }
          >
            <span className="mr-1">{l.n}</span>
            <span>{t(l.key)}</span>
          </span>
          {i < labels.length - 1 ? (
            <span className="text-muted-foreground">·</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function StepBasics({
  name,
  description,
  onNameChange,
  onDescriptionChange,
}: {
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
}) {
  const t = useTranslations('issues.categories');
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cat-name">{t('nameLabel')}</Label>
        <Input
          id="cat-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          maxLength={MAX_NAME}
          autoFocus
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cat-desc">{t('descriptionLabel')}</Label>
        <Textarea
          id="cat-desc"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          maxLength={MAX_DESCRIPTION}
        />
      </div>
    </div>
  );
}

function StepQuestions({
  questions,
  addQuestion,
  updateQuestion,
  removeQuestion,
  addOption,
  updateOption,
  removeOption,
}: {
  questions: IssueCustomQuestion[];
  addQuestion: () => void;
  updateQuestion: (index: number, patch: Partial<IssueCustomQuestion>) => void;
  removeQuestion: (index: number) => void;
  addOption: (qIndex: number) => void;
  updateOption: (qIndex: number, oIndex: number, value: string) => void;
  removeOption: (qIndex: number, oIndex: number) => void;
}) {
  const tQ = useTranslations('issues.categories.questionBuilder');
  return (
    <div className="space-y-3">
      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionRow
            key={q.id}
            question={q}
            onChange={(patch) => updateQuestion(i, patch)}
            onRemove={() => removeQuestion(i)}
            onAddOption={() => addOption(i)}
            onUpdateOption={(oIndex, value) => updateOption(i, oIndex, value)}
            onRemoveOption={(oIndex) => removeOption(i, oIndex)}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addQuestion}
          disabled={questions.length >= MAX_QUESTIONS}
        >
          <Plus className="mr-1 h-4 w-4" />
          {tQ('addButton')}
        </Button>
        <span className="text-xs text-muted-foreground">
          {tQ('counter', { count: questions.length })}
        </span>
      </div>
    </div>
  );
}

function QuestionRow({
  question,
  onChange,
  onRemove,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
}: {
  question: IssueCustomQuestion;
  onChange: (patch: Partial<IssueCustomQuestion>) => void;
  onRemove: () => void;
  onAddOption: () => void;
  onUpdateOption: (oIndex: number, value: string) => void;
  onRemoveOption: (oIndex: number) => void;
}) {
  const tQ = useTranslations('issues.categories.questionBuilder');
  const promptInvalid = question.prompt.trim().length === 0;
  const options = question.options ?? [];
  const optionsInvalid =
    question.type === 'multipleChoice' &&
    (options.length === 0 || options.some((o) => o.trim().length === 0));

  return (
    <div className="rounded-md border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="w-36 shrink-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">{tQ('typeLabel')}</Label>
          <select
            value={question.type}
            onChange={(e) =>
              onChange({ type: e.target.value as IssueCustomQuestion['type'] })
            }
            className="block w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="text">{tQ('typeText')}</option>
            <option value="multipleChoice">{tQ('typeMultipleChoice')}</option>
          </select>
        </div>
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            {tQ('promptPlaceholder')}
          </Label>
          <Input
            value={question.prompt}
            onChange={(e) => onChange({ prompt: e.target.value })}
            placeholder={tQ('promptPlaceholder')}
            maxLength={MAX_PROMPT}
          />
          {promptInvalid ? (
            <p className="text-xs text-destructive">{tQ('validationPromptEmpty')}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-center gap-2 pt-6">
          <div className="flex items-center gap-1">
            <Switch
              checked={question.required}
              onCheckedChange={(v) => onChange({ required: v })}
              aria-label={tQ('requiredLabel')}
            />
            <span className="text-xs text-muted-foreground">{tQ('requiredLabel')}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={tQ('removeButton')}
          className="mt-5 text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {question.type === 'multipleChoice' ? (
        <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-3">
          <Label className="text-xs text-muted-foreground">{tQ('choicesLabel')}</Label>
          <div className="space-y-2">
            {options.map((opt, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <Input
                  value={opt}
                  onChange={(e) => onUpdateOption(oi, e.target.value)}
                  placeholder={tQ('choicePlaceholder')}
                  maxLength={MAX_OPTION_TEXT}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveOption(oi)}
                  disabled={options.length <= 1}
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
              onClick={onAddOption}
              disabled={options.length >= MAX_OPTIONS}
            >
              <Plus className="mr-1 h-4 w-4" />
              {tQ('addChoiceButton')}
            </Button>
            {optionsInvalid ? (
              <span className="text-xs text-destructive">
                {tQ('validationOptionsEmpty')}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StepAccess({
  notificationRule,
  criticalAlerts,
  accessRuleId,
  accessRules,
  onChange,
}: {
  notificationRule: IssueNotificationRule;
  criticalAlerts: boolean;
  accessRuleId: string;
  accessRules: ReadonlyArray<{ id: string; name: string }>;
  onChange: (patch: Partial<CategoryWizardValues>) => void;
}) {
  const t = useTranslations('issues.categories');
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="cat-notif">{t('notificationRuleLabel')}</Label>
        <select
          id="cat-notif"
          value={notificationRule}
          onChange={(e) =>
            onChange({ notificationRule: e.target.value as IssueNotificationRule })
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
          checked={criticalAlerts}
          onCheckedChange={(v) => onChange({ criticalAlerts: v })}
        />
        <Label htmlFor="cat-critical">{t('criticalAlertsLabel')}</Label>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cat-access">{t('accessRuleLabel')}</Label>
        <select
          id="cat-access"
          value={accessRuleId}
          onChange={(e) => onChange({ accessRuleId: e.target.value })}
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
    </div>
  );
}
