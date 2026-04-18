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
import { Card, CardContent } from '../ui/card';
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
 * Logic tab: edit per-option triggers on multiple-choice questions.
 *
 * Surfaces a warning when the computed logic depth approaches the 40-level
 * ceiling (T-E07) — the backend rejects anything above, so catching it
 * early keeps authors from hitting a publish error.
 *
 * Follow-up question IDs are entered by ULID. A richer per-question
 * picker can replace this later without schema changes.
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
  const selectedItem =
    mcQuestions.find((i) => i.id === selectedItemId) ?? null;
  const responseSet =
    selectedItem !== null
      ? state.content.customResponseSets.find(
          (rs) => rs.id === (selectedItem as { responseSetId: string }).responseSetId,
        ) ?? null
      : null;

  const depth = maxLogicDepth(state.content);

  if (mcQuestions.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('intro')}</p>
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

      <Select value={selectedItemId ?? ''} onValueChange={(v) => setSelectedItemId(v)}>
        <SelectTrigger className="max-w-md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {mcQuestions.map((q) => (
            <SelectItem key={q.id} value={q.id}>
              {'prompt' in q ? q.prompt : q.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedItem !== null && responseSet !== null ? (
        <div className="space-y-3">
          {responseSet.options.map((opt) => (
            <OptionTriggers
              key={opt.id}
              setId={responseSet.id}
              option={opt}
            />
          ))}
        </div>
      ) : null}
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
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{option.label}</p>
          <AddTriggerButton onAdd={addTrigger} />
        </div>
        {triggers.length === 0 ? null : (
          <ul className="space-y-2">
            {triggers.map((trig, idx) => (
              <TriggerEditor
                key={idx}
                trigger={trig}
                onChange={(next) => {
                  const copy = triggers.slice();
                  copy[idx] = next;
                  updateTriggers(copy);
                }}
                onRemove={() =>
                  updateTriggers(triggers.filter((_, i) => i !== idx))
                }
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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
    <li className="rounded-md border p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {tKind(trigger.kind)}
        </span>
        <Button variant="ghost" size="sm" onClick={onRemove} aria-label={t('removeTrigger')}>
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
            onChange={(e) =>
              onChange({ kind: 'requireAction', actionTitle: e.target.value })
            }
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
                onChange({
                  ...trigger,
                  mediaKind: v as 'photo' | 'video' | 'any',
                })
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
            onChange={(e) =>
              onChange({ kind: 'requireNote', placeholder: e.target.value })
            }
          />
        </div>
      ) : null}
      {trigger.kind === 'notify' ? (
        <div className="space-y-1.5">
          <Label>{t('notify.timing')}</Label>
          <Select
            value={trigger.timing}
            onValueChange={(v) =>
              onChange({
                ...trigger,
                timing: v as 'immediate' | 'onCompletion',
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="immediate">{t('notify.timingImmediate')}</SelectItem>
              <SelectItem value="onCompletion">
                {t('notify.timingOnCompletion')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </li>
  );
}
