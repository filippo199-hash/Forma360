'use client';

import { newId } from '@forma360/shared/id';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { useEditor } from './editor-context';

/**
 * Response-sets tab: two-panel layout.
 *  Left panel  — list of response sets with selection
 *  Right panel — editor for the selected set (name, multiSelect, options)
 */
export function ResponseSetsTab() {
  const t = useTranslations('templates.editor.responseSetsTab');
  const { state, dispatch } = useEditor();

  const sets = state.content.customResponseSets;
  const [selectedSetId, setSelectedSetId] = useState<string | null>(sets[0]?.id ?? null);
  const selectedSet = sets.find((s) => s.id === selectedSetId) ?? null;

  function handleAdd() {
    const id = newId();
    dispatch({
      type: 'addResponseSet',
      set: {
        id,
        name: 'New response set',
        sourceGlobalId: null,
        multiSelect: false,
        options: [{ id: newId(), label: 'Yes', flagged: false }],
      },
    });
    setSelectedSetId(id);
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Left panel */}
      <div className="flex w-60 shrink-0 flex-col border-r border-[#E5E7EB] bg-white">
        <p className="px-4 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
          {t('nameLabel')}
        </p>

        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {sets.length === 0 ? (
            <p className="px-2 py-3 text-xs text-[#9CA3AF]">{t('empty')}</p>
          ) : (
            sets.map((set) => {
              const isSelected = set.id === selectedSetId;
              return (
                <button
                  key={set.id}
                  type="button"
                  onClick={() => setSelectedSetId(set.id)}
                  className={`flex h-11 w-full items-center justify-between rounded-md px-2 text-left text-sm transition-colors ${
                    isSelected
                      ? 'bg-[#F0FBF7] text-[#00B47E]'
                      : 'text-[#111827] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <span className="truncate font-medium">{set.name}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                      isSelected ? 'bg-[#D1FAE5] text-[#059669]' : 'bg-[#F3F4F6] text-[#6B7280]'
                    }`}
                  >
                    {set.options.length}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t border-[#E5E7EB] p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-[#00B47E] hover:bg-[#F0FBF7] hover:text-[#00B47E]"
            onClick={handleAdd}
            aria-label={t('addButton')}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('addButton')}
          </Button>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {selectedSet === null ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[#9CA3AF]">{t('empty')}</p>
          </div>
        ) : (
          <div className="mx-auto max-w-xl space-y-6">
            {/* Name + multiSelect header */}
            <div className="flex items-end gap-4">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={`rs-name-${selectedSet.id}`}>{t('nameLabel')}</Label>
                <Input
                  id={`rs-name-${selectedSet.id}`}
                  value={selectedSet.name}
                  onChange={(e) =>
                    dispatch({
                      type: 'updateResponseSet',
                      setId: selectedSet.id,
                      patch: { name: e.target.value },
                    })
                  }
                />
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch
                  id={`rs-ms-${selectedSet.id}`}
                  checked={selectedSet.multiSelect}
                  onCheckedChange={(v) =>
                    dispatch({
                      type: 'updateResponseSet',
                      setId: selectedSet.id,
                      patch: { multiSelect: v },
                    })
                  }
                />
                <Label htmlFor={`rs-ms-${selectedSet.id}`}>{t('multiSelectLabel')}</Label>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="pb-1 text-[#9CA3AF] hover:text-red-600"
                onClick={() => {
                  dispatch({ type: 'deleteResponseSet', setId: selectedSet.id });
                  setSelectedSetId(
                    sets.find((s) => s.id !== selectedSet.id)?.id ?? null,
                  );
                }}
                aria-label={t('removeOption')}
              >
                ×
              </Button>
            </div>

            {/* Options list */}
            <div className="space-y-2">
              <Label>{t('optionsLabel')}</Label>
              <div className="rounded-lg border border-[#E5E7EB] bg-white">
                {selectedSet.options.map((opt, optIdx) => (
                  <div
                    key={opt.id}
                    className="flex items-center gap-2 border-b border-[#E5E7EB] px-3 py-2 last:border-b-0"
                  >
                    <Input
                      value={opt.label}
                      placeholder={t('optionLabel')}
                      aria-label={t('optionLabel')}
                      className="flex-1 border-0 p-0 text-sm shadow-none focus-visible:ring-0"
                      onChange={(e) =>
                        dispatch({
                          type: 'updateResponseOption',
                          setId: selectedSet.id,
                          optionId: opt.id,
                          patch: { label: e.target.value },
                        })
                      }
                    />
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      <Switch
                        id={`flag-${opt.id}`}
                        checked={opt.flagged}
                        onCheckedChange={(v) =>
                          dispatch({
                            type: 'updateResponseOption',
                            setId: selectedSet.id,
                            optionId: opt.id,
                            patch: { flagged: v },
                          })
                        }
                      />
                      <Label htmlFor={`flag-${opt.id}`} className="text-xs text-[#6B7280]">
                        {t('flaggedLabel')}
                      </Label>
                    </div>
                    {selectedSet.options.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-[#9CA3AF] hover:text-red-600"
                        onClick={() =>
                          dispatch({
                            type: 'deleteResponseOption',
                            setId: selectedSet.id,
                            optionId: opt.id,
                          })
                        }
                        aria-label={t('removeOption')}
                      >
                        ×
                      </Button>
                    ) : null}
                    {/* Keep optIdx referenced so TS doesn't complain about unused var */}
                    <span className="hidden">{optIdx}</span>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-[#00B47E] text-[#00B47E] hover:bg-[#F0FBF7]"
                onClick={() =>
                  dispatch({ type: 'addResponseOption', setId: selectedSet.id })
                }
                aria-label={t('addOption')}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {t('addOption')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
