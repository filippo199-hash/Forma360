'use client';

import type { Item } from '@forma360/shared/template-schema';
import { maxLogicDepth, TEMPLATE_LIMITS } from '@forma360/shared/template-schema';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { useEditor } from './editor-context';
import { OptionTriggerEditor } from './option-trigger-editor';

/**
 * Logic tab: two-panel layout — legacy / kept for back-compat.
 *  Left panel  — list of MC questions for selection
 *  Right panel — `OptionTriggerEditor` per response option of the selected question
 *
 * The current Build tab inlines `OptionTriggerEditor` directly under each MC
 * question, so this tab is no longer reachable from the editor shell. We keep
 * the file on disk so anything linking to it still resolves.
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

  const [selectedItemId, setSelectedItemId] = useState<string | null>(mcQuestions[0]?.id ?? null);
  const selectedItem = mcQuestions.find((i) => i.id === selectedItemId) ?? null;
  const responseSet =
    selectedItem !== null
      ? (state.content.customResponseSets.find(
          (rs) => rs.id === (selectedItem as { responseSetId: string }).responseSetId,
        ) ?? null)
      : null;

  const depth = maxLogicDepth(state.content);

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left panel */}
      <div className="flex w-60 shrink-0 flex-col border-r bg-background">
        <p className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('mcQuestionsHeader')}
        </p>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {mcQuestions.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t('empty')}</p>
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
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent/60'
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
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
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
            <div className="rounded-md border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('intro')}
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {'prompt' in selectedItem ? selectedItem.prompt : selectedItem.id}
              </p>
            </div>

            {responseSet === null ? (
              <div className="rounded-md border bg-card p-4">
                <p className="text-sm text-muted-foreground">{t('noResponseSetAssigned')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {responseSet.options.map((opt) => (
                  <OptionTriggerEditor key={opt.id} setId={responseSet.id} option={opt} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
