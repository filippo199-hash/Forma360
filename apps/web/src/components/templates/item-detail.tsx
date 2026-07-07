'use client';

import type { Item } from '@forma360/shared/template-schema';
import { maxLogicDepth, TEMPLATE_LIMITS } from '@forma360/shared/template-schema';
import { parseVideoEmbed } from '@forma360/shared/video-embed';
import { FileQuestion, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useEditor } from './editor-context';
import { VisibilityControl } from './visibility-control';

/**
 * Right-side detail panel. Renders type-specific editors for whatever
 * item is currently selected. Exotic kinds (site / location / asset /
 * company / annotation / table) render a "coming soon" note — they can
 * be added to the template but not fine-tuned in this UI yet.
 */
export function ItemDetail() {
  const t = useTranslations('templates.editor');
  const tType = useTranslations('templates.editor.questionType');
  const { state } = useEditor();
  const item =
    state.selectedItemId === null
      ? null
      : findItem(
          state.content.pages.flatMap((p) => p.sections.flatMap((s) => s.items)),
          state.selectedItemId,
        );

  if (item === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <FileQuestion className="h-12 w-12 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{t('detail.empty')}</p>
      </div>
    );
  }

  const typeLabel = tType(item.type as Parameters<typeof tType>[0]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('detail.title')}
        </p>
        <p className="mt-0.5 text-sm font-medium text-foreground">{typeLabel}</p>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <CommonFields item={item} />
        <TypeSpecificFields item={item} />
        <VisibilitySection item={item} />
      </div>
    </div>
  );
}

/**
 * Walks pages → sections → items and collects every item strictly before
 * `targetId`. Returns [] if `targetId` is never encountered.
 */
function itemsBefore(
  pages: ReturnType<typeof useEditor>['state']['content']['pages'],
  targetId: string,
): Item[] {
  const acc: Item[] = [];
  for (const p of pages) {
    for (const s of p.sections) {
      for (const i of s.items) {
        if (i.id === targetId) return acc;
        acc.push(i);
      }
    }
  }
  return acc;
}

function VisibilitySection({ item }: { item: Item }) {
  const t = useTranslations('templates.editor.visibilityControl');
  const { state } = useEditor();

  // Instructions don't carry a visibility field — bail out.
  if (item.type === 'instruction') return null;
  // The non-question stubs (site/location/asset/company/annotation) render
  // a coming-soon notice already; skip visibility there too.
  if (
    item.type === 'site' ||
    item.type === 'location' ||
    item.type === 'asset' ||
    item.type === 'company' ||
    item.type === 'annotation' ||
    item.type === 'table'
  ) {
    return null;
  }

  const prior = useMemo(
    () => itemsBefore(state.content.pages, item.id),
    [state.content.pages, item.id],
  );
  const depth = useMemo(() => maxLogicDepth(state.content), [state.content]);
  const max = TEMPLATE_LIMITS.MAX_LOGIC_NESTING_DEPTH;

  return (
    <div className="space-y-2">
      <div className="border-t pt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('toggle')}
        </p>
        <VisibilityControl item={item} allItemsBefore={prior} />
        {depth >= max ? (
          <p className="mt-2 rounded-md border border-red-400 bg-red-50 p-2 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
            {t('depthBlock').replace('{depth}', String(depth)).replace('{max}', String(max))}
          </p>
        ) : depth >= max - 5 ? (
          <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            {t('depthWarning').replace('{depth}', String(depth)).replace('{max}', String(max))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function findItem(items: Item[], id: string): Item | null {
  return items.find((i) => i.id === id) ?? null;
}

function CommonFields({ item }: { item: Item }) {
  const t = useTranslations('templates.editor');
  const { dispatch } = useEditor();

  if (item.type === 'instruction') {
    return <InstructionEditor item={item} />;
  }

  return (
    <div className="space-y-3">
      {/* Prompt input — no extra label, just the input */}
      <Input
        id={`prompt-${item.id}`}
        value={item.prompt}
        onChange={(e) =>
          dispatch({ type: 'updateItem', itemId: item.id, patch: { prompt: e.target.value } })
        }
        placeholder={t('questionPrompt')}
        className="font-medium"
        aria-label={t('questionPrompt')}
      />

      {/* Toggles row */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch
            id={`req-${item.id}`}
            checked={item.required}
            onCheckedChange={(v) =>
              dispatch({ type: 'updateItem', itemId: item.id, patch: { required: v } })
            }
          />
          <Label htmlFor={`req-${item.id}`} className="text-sm text-foreground">
            {t('requiredLabel')}
          </Label>
        </div>
      </div>

      {/* Note */}
      <div className="space-y-1.5">
        <Textarea
          id={`note-${item.id}`}
          value={item.note ?? ''}
          onChange={(e) =>
            dispatch({ type: 'updateItem', itemId: item.id, patch: { note: e.target.value } })
          }
          placeholder={t('itemNote')}
          rows={2}
          aria-label={t('itemNote')}
        />
      </div>

      {/* Type settings header */}
      <div className="border-t pt-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('detail.title')}
        </p>
      </div>
    </div>
  );
}

type InstructionItem = Extract<Item, { type: 'instruction' }>;

/**
 * Instruction editor: Markdown body + file attachments (image/PDF/doc) +
 * an optional YouTube/Vimeo link + a "show in final report" toggle.
 */
function InstructionEditor({ item }: { item: InstructionItem }) {
  const t = useTranslations('templates.editor.detail.instruction');
  const { dispatch } = useEditor();
  const params = useParams();
  const templateId = typeof params.templateId === 'string' ? params.templateId : '';
  const [uploading, setUploading] = useState(false);
  const [videoInput, setVideoInput] = useState(item.videoUrl ?? '');
  const [videoError, setVideoError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (p: Partial<InstructionItem>) =>
    dispatch({ type: 'updateItem', itemId: item.id, patch: p });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined || templateId === '') return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('templateId', templateId);
      form.append('file', file);
      const res = await fetch('/api/upload/template-media', { method: 'POST', body: form });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { key: string; filename: string; mimeType: string };
      patch({
        attachments: [
          ...item.attachments,
          { key: body.key, filename: body.filename, mimeType: body.mimeType },
        ].slice(0, 10),
      });
    } catch {
      toast.error(t('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  function commitVideo() {
    const v = videoInput.trim();
    if (v === '') {
      setVideoError(false);
      // Clear the optional field. Cast: exactOptionalPropertyTypes forbids an
      // explicit `undefined` in the Item literal, but the reducer/Zod treat a
      // missing/undefined videoUrl identically.
      dispatch({
        type: 'updateItem',
        itemId: item.id,
        patch: { videoUrl: undefined } as Partial<Item>,
      });
      return;
    }
    if (parseVideoEmbed(v) === null) {
      setVideoError(true);
      return;
    }
    setVideoError(false);
    patch({ videoUrl: v });
  }

  return (
    <div className="space-y-4">
      {/* Body (Markdown) */}
      <div className="space-y-1.5">
        <Label htmlFor={`body-${item.id}`}>{t('body')}</Label>
        <Textarea
          id={`body-${item.id}`}
          value={item.body}
          onChange={(e) => patch({ body: e.target.value })}
          placeholder={t('body')}
          rows={4}
        />
      </div>

      {/* Attachments */}
      <div className="space-y-2">
        <Label>{t('attachments')}</Label>
        {item.attachments.length > 0 && (
          <ul className="space-y-1">
            {item.attachments.map((a) => (
              <li
                key={a.key}
                className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm"
              >
                <span className="truncate" title={a.filename}>
                  {a.filename}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    patch({ attachments: item.attachments.filter((x) => x.key !== a.key) })
                  }
                  className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  aria-label={t('removeFile')}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
          hidden
          onChange={onFile}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading || item.attachments.length >= 10}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? t('uploading') : t('addFile')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('attachmentsHint')}</p>
      </div>

      {/* Video link */}
      <div className="space-y-1.5">
        <Label htmlFor={`video-${item.id}`}>{t('videoLink')}</Label>
        <Input
          id={`video-${item.id}`}
          value={videoInput}
          onChange={(e) => {
            setVideoInput(e.target.value);
            setVideoError(false);
          }}
          onBlur={commitVideo}
          placeholder="https://youtu.be/…"
        />
        {videoError ? (
          <p className="text-xs text-destructive">{t('videoInvalid')}</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('videoHint')}</p>
        )}
      </div>

      {/* Show in report */}
      <div className="flex items-start justify-between gap-3 border-t pt-3">
        <div className="space-y-0.5">
          <Label htmlFor={`report-${item.id}`}>{t('showInReport')}</Label>
          <p className="text-xs text-muted-foreground">{t('showInReportHint')}</p>
        </div>
        <Switch
          id={`report-${item.id}`}
          checked={item.showInReport}
          onCheckedChange={(c) => patch({ showInReport: c })}
        />
      </div>
    </div>
  );
}

function TypeSpecificFields({ item }: { item: Item }) {
  const t = useTranslations('templates.editor.detail');
  const tStub = useTranslations('templates.editor');
  const { state, dispatch } = useEditor();

  switch (item.type) {
    case 'text':
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Switch
              id={`ml-${item.id}`}
              checked={item.multiline}
              onCheckedChange={(v) =>
                dispatch({ type: 'updateItem', itemId: item.id, patch: { multiline: v } })
              }
            />
            <Label htmlFor={`ml-${item.id}`}>{t('text.multiline')}</Label>
          </div>
          <Label htmlFor={`max-${item.id}`}>{t('text.maxLength')}</Label>
          <Input
            id={`max-${item.id}`}
            type="number"
            min={1}
            max={10000}
            value={item.maxLength}
            onChange={(e) =>
              dispatch({
                type: 'updateItem',
                itemId: item.id,
                patch: { maxLength: Math.max(1, Number(e.target.value) || 1) },
              })
            }
          />
        </div>
      );
    case 'number':
      return (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`min-${item.id}`}>{t('number.min')}</Label>
              <Input
                id={`min-${item.id}`}
                type="number"
                value={item.min ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  dispatch({
                    type: 'updateItem',
                    itemId: item.id,
                    patch: v === '' ? { min: undefined } : { min: Number(v) },
                  });
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`max-n-${item.id}`}>{t('number.max')}</Label>
              <Input
                id={`max-n-${item.id}`}
                type="number"
                value={item.max ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  dispatch({
                    type: 'updateItem',
                    itemId: item.id,
                    patch: v === '' ? { max: undefined } : { max: Number(v) },
                  });
                }}
              />
            </div>
          </div>
          <Label htmlFor={`dec-${item.id}`}>{t('number.decimalPlaces')}</Label>
          <Input
            id={`dec-${item.id}`}
            type="number"
            min={0}
            max={10}
            value={item.decimalPlaces}
            onChange={(e) =>
              dispatch({
                type: 'updateItem',
                itemId: item.id,
                patch: { decimalPlaces: Math.max(0, Math.min(10, Number(e.target.value) || 0)) },
              })
            }
          />
          <Label htmlFor={`unit-${item.id}`}>{t('number.unit')}</Label>
          <Input
            id={`unit-${item.id}`}
            value={item.unit ?? ''}
            onChange={(e) =>
              dispatch({ type: 'updateItem', itemId: item.id, patch: { unit: e.target.value } })
            }
          />
        </div>
      );
    case 'slider':
      return (
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`smin-${item.id}`}>{t('slider.min')}</Label>
            <Input
              id={`smin-${item.id}`}
              type="number"
              value={item.min}
              onChange={(e) =>
                dispatch({
                  type: 'updateItem',
                  itemId: item.id,
                  patch: { min: Number(e.target.value) || 0 },
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`smax-${item.id}`}>{t('slider.max')}</Label>
            <Input
              id={`smax-${item.id}`}
              type="number"
              value={item.max}
              onChange={(e) =>
                dispatch({
                  type: 'updateItem',
                  itemId: item.id,
                  patch: { max: Number(e.target.value) || 0 },
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`sstep-${item.id}`}>{t('slider.step')}</Label>
            <Input
              id={`sstep-${item.id}`}
              type="number"
              min={0.001}
              step="any"
              value={item.step}
              onChange={(e) =>
                dispatch({
                  type: 'updateItem',
                  itemId: item.id,
                  patch: { step: Math.max(0.001, Number(e.target.value) || 1) },
                })
              }
            />
          </div>
        </div>
      );
    case 'media':
      return (
        <div className="space-y-2">
          <Label>{t('media.mediaKind')}</Label>
          <Select
            value={item.mediaKind}
            onValueChange={(v) =>
              dispatch({
                type: 'updateItem',
                itemId: item.id,
                patch: { mediaKind: v as typeof item.mediaKind },
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t('media.kindAny')}</SelectItem>
              <SelectItem value="photo">{t('media.kindPhoto')}</SelectItem>
              <SelectItem value="video">{t('media.kindVideo')}</SelectItem>
              <SelectItem value="pdf">{t('media.kindPdf')}</SelectItem>
            </SelectContent>
          </Select>
          <Label htmlFor={`mc-${item.id}`}>{t('media.maxCount')}</Label>
          <Input
            id={`mc-${item.id}`}
            type="number"
            min={1}
            max={50}
            value={item.maxCount}
            onChange={(e) =>
              dispatch({
                type: 'updateItem',
                itemId: item.id,
                patch: { maxCount: Math.max(1, Math.min(50, Number(e.target.value) || 1)) },
              })
            }
          />
        </div>
      );
    case 'signature':
      return (
        <div className="space-y-2">
          <Label>{t('signature.mode')}</Label>
          <Select
            value={item.mode}
            onValueChange={(v) =>
              dispatch({
                type: 'updateItem',
                itemId: item.id,
                patch: { mode: v as 'sequential' | 'parallel' },
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sequential">{t('signature.modeSequential')}</SelectItem>
              <SelectItem value="parallel">{t('signature.modeParallel')}</SelectItem>
            </SelectContent>
          </Select>
          <div className="space-y-1.5">
            {item.slots.map((slot, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                <Input
                  value={slot.label ?? ''}
                  placeholder={t('signature.slotLabel')}
                  aria-label={t('signature.slotLabel')}
                  onChange={(e) => {
                    const next = item.slots.map((s, i) =>
                      i === idx ? { ...s, label: e.target.value } : s,
                    );
                    dispatch({ type: 'updateItem', itemId: item.id, patch: { slots: next } });
                  }}
                />
                {item.slots.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const next = item.slots
                        .filter((_, i) => i !== idx)
                        .map((s, i) => ({ ...s, slotIndex: i }));
                      dispatch({
                        type: 'updateItem',
                        itemId: item.id,
                        patch: { slots: next },
                      });
                    }}
                    aria-label={t('signature.removeSlot')}
                  >
                    ×
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
          {item.slots.length < 10 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next = [
                  ...item.slots,
                  { slotIndex: item.slots.length, assigneeUserId: null },
                ];
                dispatch({ type: 'updateItem', itemId: item.id, patch: { slots: next } });
              }}
              aria-label={t('signature.addSlot')}
            >
              {t('signature.addSlot')}
            </Button>
          ) : null}
        </div>
      );
    case 'checkbox':
      return (
        <div className="space-y-2">
          <Label htmlFor={`clabel-${item.id}`}>{t('checkbox.label')}</Label>
          <Input
            id={`clabel-${item.id}`}
            value={item.label}
            onChange={(e) =>
              dispatch({ type: 'updateItem', itemId: item.id, patch: { label: e.target.value } })
            }
          />
        </div>
      );
    case 'multipleChoice': {
      const sets = state.content.customResponseSets;
      return (
        <div className="space-y-2">
          <Label>{t('multipleChoice.responseSet')}</Label>
          <Select
            value={item.responseSetId}
            onValueChange={(v) =>
              dispatch({
                type: 'updateItem',
                itemId: item.id,
                patch: { responseSetId: v },
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t('multipleChoice.noResponseSet')} />
            </SelectTrigger>
            <SelectContent>
              {sets.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">
                  {t('multipleChoice.noResponseSet')}
                </div>
              ) : (
                sets.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>
      );
    }
    case 'site':
    case 'location':
    case 'asset':
    case 'company':
    case 'annotation':
      return (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          {tStub('stubNotice')}
        </div>
      );
    default:
      // No extra editor for date / datetime / time / conductedBy /
      // inspectionDate / documentNumber — just the common fields.
      return null;
  }
}
