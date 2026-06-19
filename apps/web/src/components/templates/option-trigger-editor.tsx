'use client';

/**
 * Reusable per-option trigger editor.
 *
 * Two surfaces consume this:
 *  - The inline (Build-tab) expansion under each multipleChoice question — one
 *    instance of `OptionTriggerEditor` per response option of the question's
 *    response set.
 *  - The (legacy) `LogicTab` — renders the same editor in the right panel of
 *    its two-panel layout.
 *
 * Everything goes through the editor reducer's `updateResponseOption` action,
 * so dirty-tracking + persistence are unchanged.
 */

import type { ResponseOption, Trigger } from '@forma360/shared/template-schema';
import { Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { responseChipClasses } from '../../lib/response-colors';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useEditor } from './editor-context';

interface OptionTriggerEditorProps {
  setId: string;
  option: ResponseOption;
  /** Whether this response is flagged for the current question. */
  flagged?: boolean;
  /** Toggle the per-question flag. When omitted, no flag control is shown. */
  onToggleFlag?: () => void;
}

/** Renders a card with the option header, every trigger, and an "Add action" picker. */
export function OptionTriggerEditor({
  setId,
  option,
  flagged = false,
  onToggleFlag,
}: OptionTriggerEditorProps) {
  const t = useTranslations('templates.editor.logicTab');
  const { dispatch } = useEditor();
  const triggers: ReadonlyArray<Trigger> = option.triggers ?? [];

  function updateTriggers(next: Trigger[]) {
    dispatch({
      type: 'updateResponseOption',
      setId,
      optionId: option.id,
      patch: { triggers: next },
    });
  }

  function addTrigger(kind: Trigger['kind']) {
    const stub: Trigger =
      kind === 'askFollowUp'
        ? { kind, questionIds: [] }
        : kind === 'requireAction'
          ? { kind, actionTitle: 'Follow up' }
          : kind === 'requireEvidence'
            ? { kind, mediaKind: 'any', minCount: 1 }
            : kind === 'requireNote'
              ? { kind }
              : {
                  kind: 'notify',
                  recipients: { userIds: [], groupIds: [], siteIds: [] },
                  timing: 'onCompletion',
                };
    updateTriggers([...triggers, stub]);
  }

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${responseChipClasses(option.color)}`}
          >
            {option.label}
          </span>
          {onToggleFlag !== undefined ? (
            <button
              type="button"
              onClick={onToggleFlag}
              aria-pressed={flagged}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
                flagged
                  ? 'border-orange-200 bg-orange-100 text-orange-700'
                  : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Flag className={cn('h-3 w-3', flagged && 'fill-orange-500 text-orange-500')} />
              {t('flagLabel')}
            </button>
          ) : null}
          {triggers.length > 0 ? (
            <span className="text-xs text-muted-foreground">
              {`→ ${String(triggers.length)} ${triggers.length === 1 ? t('triggerCountSingular') : t('triggerCountPlural')}`}
            </span>
          ) : null}
        </div>
        <AddTriggerButton onAdd={addTrigger} />
      </div>

      {triggers.length > 0 ? (
        <ul className="divide-y">
          {triggers.map((trig, idx) => (
            <TriggerEditor
              key={idx}
              trigger={trig}
              onChange={(next) => {
                const copy = triggers.slice();
                copy[idx] = next;
                updateTriggers(copy);
              }}
              onRemove={() => updateTriggers(triggers.filter((_, i) => i !== idx))}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-xs text-muted-foreground">{t('addTrigger')}</p>
      )}
    </div>
  );
}

function AddTriggerButton({ onAdd }: { onAdd: (k: Trigger['kind']) => void }) {
  const t = useTranslations('templates.editor.logicTab');
  const tKind = useTranslations('templates.editor.logicTab.kind');
  const tInline = useTranslations('templates.editor.inlineActions');
  const kinds: Trigger['kind'][] = [
    'askFollowUp',
    'requireAction',
    'requireEvidence',
    'requireNote',
    'notify',
  ];
  return (
    <Select value="" onValueChange={(v) => onAdd(v as Trigger['kind'])}>
      <SelectTrigger className="h-8 w-44">
        <SelectValue placeholder={tInline('addAction')} />
      </SelectTrigger>
      <SelectContent>
        {kinds.map((k) => (
          <SelectItem key={k} value={k}>
            {tKind(k)}
          </SelectItem>
        ))}
      </SelectContent>
      {/* keep `t` referenced for tests/inheritance */}
      <span className="hidden">{t('addTrigger')}</span>
    </Select>
  );
}

function TriggerEditor({
  trigger,
  onChange,
  onRemove,
}: {
  trigger: Trigger;
  onChange: (t: Trigger) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('templates.editor.logicTab');
  const tKind = useTranslations('templates.editor.logicTab.kind');
  const tInline = useTranslations('templates.editor.inlineActions');

  return (
    <li className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="rounded bg-accent px-2 py-0.5 text-xs font-semibold uppercase text-accent-foreground">
          {tKind(trigger.kind)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
          onClick={onRemove}
          aria-label={tInline('removeAction')}
        >
          ×
        </Button>
      </div>

      {trigger.kind === 'askFollowUp' ? (
        <div className="space-y-1.5">
          <Label>{t('askFollowUp.questionIds')}</Label>
          <Input
            value={trigger.questionIds.join(', ')}
            onChange={(e) => {
              const ids = e.target.value
                .split(/[,\s]+/)
                .map((s) => s.trim())
                .filter((s) => s.length === 26);
              onChange({ kind: 'askFollowUp', questionIds: ids });
            }}
          />
        </div>
      ) : null}
      {trigger.kind === 'requireAction' ? (
        <div className="space-y-1.5">
          <Label>{t('requireAction.actionTitle')}</Label>
          <Input
            value={trigger.actionTitle}
            onChange={(e) => onChange({ kind: 'requireAction', actionTitle: e.target.value })}
          />
        </div>
      ) : null}
      {trigger.kind === 'requireEvidence' ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>{t('requireEvidence.mediaKind')}</Label>
            <Select
              value={trigger.mediaKind}
              onValueChange={(v) =>
                onChange({ ...trigger, mediaKind: v as 'photo' | 'video' | 'any' })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">any</SelectItem>
                <SelectItem value="photo">photo</SelectItem>
                <SelectItem value="video">video</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('requireEvidence.minCount')}</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={trigger.minCount}
              onChange={(e) =>
                onChange({
                  ...trigger,
                  minCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)),
                })
              }
            />
          </div>
        </div>
      ) : null}
      {trigger.kind === 'requireNote' ? (
        <div className="space-y-1.5">
          <Label>{t('requireNote.placeholder')}</Label>
          <Input
            value={trigger.placeholder ?? ''}
            onChange={(e) => onChange({ kind: 'requireNote', placeholder: e.target.value })}
          />
        </div>
      ) : null}
      {trigger.kind === 'notify' ? (
        <div className="space-y-1.5">
          <Label>{t('notify.timing')}</Label>
          <Select
            value={trigger.timing}
            onValueChange={(v) =>
              onChange({ ...trigger, timing: v as 'immediate' | 'onCompletion' })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">{t('notify.timingImmediate')}</SelectItem>
              <SelectItem value="onCompletion">{t('notify.timingOnCompletion')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </li>
  );
}
