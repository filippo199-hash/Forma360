'use client';

import type {
  Item,
  ResponseOption,
  Trigger,
} from '@forma360/shared/template-schema';
import { maxLogicDepth, TEMPLATE_LIMITS } from '@forma360/shared/template-schema';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useEditor } from './editor-context';

/**
 * Logic tab: two-panel layout.
 *  Left panel  — list of MC questions for selection
 *  Right panel — trigger editor for the selected question's response options
 */
export function LogicTab() {
  const t = useTranslations('templates.editor.logicTab');
  const { state } = useEditor();

  const mcQuestions = useMemo(() => {
    const items: Item[] = [];
    for (const p of state.content.pages) {
      for (const s of p.sections) {
        for (const i of s.items) {
          if (i.type === 'multipleChoice') items.push(i);
        }
      }
    }
    return items;
  }, [state.content.pages]);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(
    mcQuestions[0]?.id ?? null,
  );
  const selectedItem = mcQuestions.find((i) => i.id === selectedItemId) ?? null;
  const responseSet =
    selectedItem !== null
      ? state.content.customResponseSets.find(
          (rs) => rs.id === (selectedItem as { responseSetId: string }).responseSetId,
        ) ?? null
      : null;

  const depth = maxLogicDepth(state.content);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left panel */}
      <div className="flex w-60 shrink-0 flex-col border-r border-[#E5E7EB] bg-white">
        <p className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
          {t('mcQuestionsHeader')}
        </p>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {mcQuestions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-[#9CA3AF]">{t('empty')}</p>
          ) : (
            mcQuestions.map((q) => {
              const label = 'prompt' in q ? q.prompt : q.id;
              const isSelected = q.id === selectedItemId;
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSelectedItemId(q.id)}
                  className={`flex h-11 w-full items-center rounded-md px-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-[#F0FBF7] text-[#00B47E]'
                      : 'text-[#111827] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <span className="truncate font-medium">{label}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedItem === null ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[#9CA3AF]">{t('empty')}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {/* Depth warning */}
            {depth >= TEMPLATE_LIMITS.MAX_LOGIC_NESTING_DEPTH - 5 ? (
              <p
                role="alert"
                className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
              >
                {t('depthWarning', {
                  depth,
                  max: TEMPLATE_LIMITS.MAX_LOGIC_NESTING_DEPTH,
                })}
              </p>
            ) : null}

            {/* Question prompt header */}
            <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                {t('intro')}
              </p>
              <p className="mt-1 text-lg font-semibold text-[#111827]">
                {'prompt' in selectedItem ? selectedItem.prompt : selectedItem.id}
              </p>
            </div>

            {responseSet === null ? (
              <div className="rounded-lg border border-[#E5E7EB] bg-white p-4">
                <p className="text-sm text-[#6B7280]">
                  {t('noResponseSetAssigned')}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {responseSet.options.map((opt) => (
                  <OptionTriggers
                    key={opt.id}
                    setId={responseSet.id}
                    option={opt}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OptionTriggers({
  setId,
  option,
}: {
  setId: string;
  option: ResponseOption;
}) {
  const t = useTranslations('templates.editor.logicTab');
  const { dispatch } = useEditor();
  const triggers = option.triggers ?? [];

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
    <div className="rounded-lg border border-[#E5E7EB] bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-[#E5E7EB] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded bg-[#F3F4F6] px-2 py-0.5 text-sm font-medium text-[#111827]">
            {option.label}
          </span>
          {triggers.length > 0 ? (
            <span className="text-xs text-[#6B7280]">
              {`→ ${String(triggers.length)} ${triggers.length === 1 ? t('triggerCountSingular') : t('triggerCountPlural')}`}
            </span>
          ) : null}
        </div>
        <AddTriggerButton onAdd={addTrigger} />
      </div>

      {triggers.length > 0 ? (
        <ul className="divide-y divide-[#E5E7EB]">
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
        <p className="px-4 py-3 text-xs text-[#9CA3AF]">{t('addTrigger')}</p>
      )}
    </div>
  );
}

function AddTriggerButton({ onAdd }: { onAdd: (k: Trigger['kind']) => void }) {
  const t = useTranslations('templates.editor.logicTab');
  const tKind = useTranslations('templates.editor.logicTab.kind');
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
        <SelectValue placeholder={t('addTrigger')} />
      </SelectTrigger>
      <SelectContent>
        {kinds.map((k) => (
          <SelectItem key={k} value={k}>
            {tKind(k)}
          </SelectItem>
        ))}
      </SelectContent>
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

  return (
    <li className="px-4 py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="rounded bg-[#F0FBF7] px-2 py-0.5 text-xs font-semibold uppercase text-[#00B47E]">
          {tKind(trigger.kind)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-[#9CA3AF] hover:text-red-600"
          onClick={onRemove}
          aria-label={t('removeTrigger')}
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
