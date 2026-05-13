'use client';

import type { IssueCustomQuestion } from '@forma360/shared/issues-schema';
import { newId } from '@forma360/shared/id';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';

const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 20;
const MAX_PROMPT = 500;
const MAX_OPTION_TEXT = 200;

interface CustomQuestionsEditorProps {
  questions: IssueCustomQuestion[];
  onChange: (next: IssueCustomQuestion[]) => void;
}

/**
 * Reusable editor for an observation category's custom questions. Each
 * row exposes a type select (Text / Multiple choice), a prompt input, a
 * Required switch and an X to remove. Multiple-choice rows expand to a
 * sub-section for adding / removing choice strings.
 *
 * Extracted from the old `CategoryWizard` so the category detail page
 * (the new "Custom questions" card) and any future surface can share the
 * same builder.
 */
export function CustomQuestionsEditor({ questions, onChange }: CustomQuestionsEditorProps) {
  const tQ = useTranslations('issues.categories.questionBuilder');

  function addQuestion() {
    if (questions.length >= MAX_QUESTIONS) return;
    const next: IssueCustomQuestion = {
      id: newId(),
      prompt: '',
      type: 'text',
      required: false,
    };
    onChange([...questions, next]);
  }

  function updateQuestion(index: number, patch: Partial<IssueCustomQuestion>) {
    const list = questions.slice();
    const current = list[index];
    if (current === undefined) return;
    const merged: IssueCustomQuestion = { ...current, ...patch };
    // Seed an empty option when switching to multipleChoice so the
    // validation prompt has something to attach to.
    if (
      merged.type === 'multipleChoice' &&
      (merged.options === undefined || merged.options.length === 0)
    ) {
      merged.options = [''];
    }
    // Drop options entirely when switching back to text.
    if (merged.type === 'text') {
      delete merged.options;
    }
    list[index] = merged;
    onChange(list);
  }

  function removeQuestion(index: number) {
    const list = questions.slice();
    list.splice(index, 1);
    onChange(list);
  }

  function addOption(qIndex: number) {
    const list = questions.slice();
    const current = list[qIndex];
    if (current === undefined || current.type !== 'multipleChoice') return;
    const opts = (current.options ?? []).slice();
    if (opts.length >= MAX_OPTIONS) return;
    opts.push('');
    list[qIndex] = { ...current, options: opts };
    onChange(list);
  }

  function updateOption(qIndex: number, oIndex: number, value: string) {
    const list = questions.slice();
    const current = list[qIndex];
    if (current === undefined || current.type !== 'multipleChoice') return;
    const opts = (current.options ?? []).slice();
    if (opts[oIndex] === undefined) return;
    opts[oIndex] = value;
    list[qIndex] = { ...current, options: opts };
    onChange(list);
  }

  function removeOption(qIndex: number, oIndex: number) {
    const list = questions.slice();
    const current = list[qIndex];
    if (current === undefined || current.type !== 'multipleChoice') return;
    const opts = (current.options ?? []).slice();
    if (opts.length <= 1) return;
    opts.splice(oIndex, 1);
    list[qIndex] = { ...current, options: opts };
    onChange(list);
  }

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

/**
 * Normalise (trim) the question list before sending it to the server.
 * Mirrors the old wizard's handleSave behaviour so the validation contract
 * the API enforces stays the same.
 */
export function normaliseCustomQuestions(questions: IssueCustomQuestion[]): IssueCustomQuestion[] {
  return questions.map((q) => {
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
  });
}

/**
 * Returns true if every question has a non-empty prompt and (for
 * multipleChoice) at least one non-empty option.
 */
export function customQuestionsAreValid(questions: IssueCustomQuestion[]): boolean {
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
            onChange={(e) => onChange({ type: e.target.value as IssueCustomQuestion['type'] })}
            className="block w-full rounded-md border border-input bg-background px-2 py-2 text-sm"
          >
            <option value="text">{tQ('typeText')}</option>
            <option value="multipleChoice">{tQ('typeMultipleChoice')}</option>
          </select>
        </div>
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">{tQ('promptPlaceholder')}</Label>
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
              <span className="text-xs text-destructive">{tQ('validationOptionsEmpty')}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
