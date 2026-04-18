'use client';

import type { CustomResponseSet, Item } from '@forma360/shared/template-schema';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { trpc } from '../../lib/trpc/client';
import { useConduct } from './conduct-context';
import { InstructionBody } from './instruction-render';
import { SignaturePad } from './signature-pad';

/**
 * Renders the right editor control for an item. The conduct reducer owns
 * the response map — this component is a controlled-input leaf.
 *
 * We keep this file as one switch because each case is small and the
 * shared layout (label + required marker + help text) benefits from a
 * single source of truth.
 */
export function ResponseInput({
  item,
  readonly,
  responseSets,
}: {
  item: Item;
  readonly: boolean;
  responseSets: CustomResponseSet[];
}) {
  switch (item.type) {
    case 'text':
      return <TextInput item={item} readonly={readonly} />;
    case 'number':
      return <NumberInput item={item} readonly={readonly} />;
    case 'date':
    case 'time':
    case 'datetime':
      return <DateLikeInput item={item} readonly={readonly} />;
    case 'multipleChoice':
      return <MultipleChoiceInput item={item} readonly={readonly} responseSets={responseSets} />;
    case 'checkbox':
      return <CheckboxInput item={item} readonly={readonly} />;
    case 'slider':
      return <SliderInput item={item} readonly={readonly} />;
    case 'media':
      return <MediaInput item={item} readonly={readonly} />;
    case 'signature':
      return <SignatureInput item={item} readonly={readonly} />;
    case 'instruction':
      return <InstructionBody body={item.body} />;
    case 'conductedBy':
      return <ReadonlyField kind="conductedBy" />;
    case 'inspectionDate':
      return <ReadonlyField kind="inspectionDate" />;
    case 'documentNumber':
      return <ReadonlyField kind="documentNumber" />;
    case 'site':
    case 'asset':
    case 'company':
    case 'location':
    case 'annotation':
    case 'table':
      return <StubNotice />;
  }
}

// ─── Individual inputs ──────────────────────────────────────────────────────

function StubNotice() {
  const t = useTranslations('inspections.conduct');
  return <p className="text-sm italic text-muted-foreground">{t('stubNotice')}</p>;
}

function TextInput({ item, readonly }: { item: Extract<Item, { type: 'text' }>; readonly: boolean }) {
  const t = useTranslations('inspections.conduct.response.text');
  const { state, dispatch } = useConduct();
  const raw = state.responses[item.id];
  const value = typeof raw === 'string' ? raw : '';
  const remaining = item.maxLength - value.length;

  function onChange(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: e.target.value });
  }

  if (item.multiline) {
    return (
      <div className="space-y-1">
        <Textarea
          value={value}
          onChange={onChange}
          maxLength={item.maxLength}
          disabled={readonly}
          placeholder={t('placeholder')}
          rows={4}
          className="min-h-[96px]"
          aria-label={item.prompt}
        />
        <p className="text-xs text-muted-foreground">
          {t('charsRemaining', { count: remaining })}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        type="text"
        value={value}
        onChange={onChange}
        maxLength={item.maxLength}
        disabled={readonly}
        placeholder={t('placeholder')}
        aria-label={item.prompt}
      />
      <p className="text-xs text-muted-foreground">
        {t('charsRemaining', { count: remaining })}
      </p>
    </div>
  );
}

function NumberInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'number' }>;
  readonly: boolean;
}) {
  const t = useTranslations('inspections.conduct.response.number');
  const { state, dispatch } = useConduct();
  const raw = state.responses[item.id];
  const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
  const numValue = value === '' ? null : Number(value);
  const belowMin = item.min !== undefined && numValue !== null && numValue < item.min;
  const aboveMax = item.max !== undefined && numValue !== null && numValue > item.max;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: e.target.value })}
          min={item.min}
          max={item.max}
          step={item.decimalPlaces === 0 ? 1 : 10 ** -item.decimalPlaces}
          disabled={readonly}
          placeholder={t('placeholder')}
          aria-label={item.prompt}
          className="max-w-[12rem]"
        />
        {item.unit !== undefined ? (
          <span className="text-sm text-muted-foreground">{item.unit}</span>
        ) : null}
      </div>
      {belowMin ? (
        <p className="text-xs text-destructive">{t('belowMin', { min: item.min ?? 0 })}</p>
      ) : null}
      {aboveMax ? (
        <p className="text-xs text-destructive">{t('aboveMax', { max: item.max ?? 0 })}</p>
      ) : null}
    </div>
  );
}

function DateLikeInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'date' | 'time' | 'datetime' }>;
  readonly: boolean;
}) {
  const { state, dispatch } = useConduct();
  const raw = state.responses[item.id];
  const value = typeof raw === 'string' ? raw : '';
  const inputType = item.type === 'date' ? 'date' : item.type === 'time' ? 'time' : 'datetime-local';
  return (
    <Input
      type={inputType}
      value={value}
      onChange={(e) => dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: e.target.value })}
      disabled={readonly}
      aria-label={item.prompt}
      className="max-w-[16rem]"
    />
  );
}

function MultipleChoiceInput({
  item,
  readonly,
  responseSets,
}: {
  item: Extract<Item, { type: 'multipleChoice' }>;
  readonly: boolean;
  responseSets: CustomResponseSet[];
}) {
  const { state, dispatch } = useConduct();
  const t = useTranslations('inspections.conduct.response.multipleChoice');
  const set = useMemo(
    () => responseSets.find((s) => s.id === item.responseSetId),
    [responseSets, item.responseSetId],
  );

  if (set === undefined) {
    return <p className="text-xs text-muted-foreground">{t('select')}</p>;
  }

  const raw = state.responses[item.id];
  const selectedSingle = typeof raw === 'string' ? raw : '';
  const selectedMulti = Array.isArray(raw) ? (raw as string[]) : [];

  function toggleSingle(optionId: string) {
    dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: optionId });
  }
  function toggleMulti(optionId: string) {
    const next = selectedMulti.includes(optionId)
      ? selectedMulti.filter((o) => o !== optionId)
      : [...selectedMulti, optionId];
    dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: next });
  }

  return (
    <ul className="space-y-2">
      {set.options.map((option) => {
        const isSelected = set.multiSelect
          ? selectedMulti.includes(option.id)
          : selectedSingle === option.id;
        return (
          <li key={option.id}>
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
              <input
                type={set.multiSelect ? 'checkbox' : 'radio'}
                name={item.id}
                checked={isSelected}
                onChange={() => (set.multiSelect ? toggleMulti(option.id) : toggleSingle(option.id))}
                disabled={readonly}
                className="h-5 w-5"
              />
              <span>{option.label}</span>
              {option.flagged ? (
                <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                  {'!'}
                </span>
              ) : null}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function CheckboxInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'checkbox' }>;
  readonly: boolean;
}) {
  const { state, dispatch } = useConduct();
  const raw = state.responses[item.id];
  const checked = typeof raw === 'boolean' ? raw : false;
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: e.target.checked })}
        disabled={readonly}
        className="h-5 w-5"
      />
      <span>{item.label}</span>
    </label>
  );
}

function SliderInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'slider' }>;
  readonly: boolean;
}) {
  const t = useTranslations('inspections.conduct.response.slider');
  const { state, dispatch } = useConduct();
  const raw = state.responses[item.id];
  const value = typeof raw === 'number' ? raw : item.min;
  return (
    <div className="space-y-2">
      <input
        type="range"
        min={item.min}
        max={item.max}
        step={item.step}
        value={value}
        onChange={(e) => dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: Number(e.target.value) })}
        disabled={readonly}
        className="w-full"
        aria-label={item.prompt}
      />
      <p className="text-sm text-muted-foreground">{t('value', { value })}</p>
    </div>
  );
}

function MediaInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'media' }>;
  readonly: boolean;
}) {
  const t = useTranslations('inspections.conduct.response.media');
  const tConduct = useTranslations('inspections.conduct');
  const { state, dispatch } = useConduct();
  const raw = state.responses[item.id];
  const keys: string[] = Array.isArray(raw) ? (raw as string[]) : [];
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('inspectionId', state.inspectionId);
      form.append('itemId', item.id);
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`upload failed ${res.status}`);
      const body = (await res.json()) as { key: string };
      const next = [...keys, body.key].slice(0, item.maxCount);
      dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: next });
    } catch {
      toast.error(tConduct('uploadError'));
    } finally {
      setUploading(false);
    }
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file !== undefined) {
      await upload(file);
      e.target.value = '';
    }
  }

  function remove(key: string) {
    const next = keys.filter((k) => k !== key);
    dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: next });
  }

  return (
    <div className="space-y-2">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
        <input
          type="file"
          accept={
            item.mediaKind === 'photo'
              ? 'image/*'
              : item.mediaKind === 'video'
                ? 'video/*'
                : item.mediaKind === 'pdf'
                  ? 'application/pdf'
                  : 'image/*,video/*,application/pdf'
          }
          capture={item.mediaKind === 'photo' ? 'environment' : undefined}
          onChange={onChange}
          disabled={readonly || uploading || keys.length >= item.maxCount}
          className="hidden"
        />
        <span>{uploading ? t('uploading') : t('upload')}</span>
      </label>
      {keys.length > 0 ? (
        <>
          <p className="text-xs text-muted-foreground">{t('uploaded', { count: keys.length })}</p>
          <ul className="space-y-1">
            {keys.map((k) => (
              <li
                key={k}
                className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-2 py-1 text-xs"
              >
                <span className="truncate font-mono">{k}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(k)}
                  disabled={readonly}
                >
                  {t('remove')}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function SignatureInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'signature' }>;
  readonly: boolean;
}) {
  const t = useTranslations('inspections.conduct.response.signature');
  const { state } = useConduct();
  const utils = trpc.useUtils();
  const slotsQuery = trpc.signatures.listSlots.useQuery({ inspectionId: state.inspectionId });
  const sign = trpc.signatures.sign.useMutation({
    onSuccess: () => {
      toast.success(t('saveSuccess'));
      void utils.signatures.listSlots.invalidate({ inspectionId: state.inspectionId });
      void utils.inspections.get.invalidate({ inspectionId: state.inspectionId });
    },
    onError: () => {
      toast.error(t('saveError'));
    },
  });

  const signed = slotsQuery.data?.signed ?? [];
  const slotsForItem = item.slots;

  return (
    <div className="space-y-4">
      {slotsForItem.map((slot) => {
        const existing = signed.find((s) => s.slotId === item.id && s.slotIndex === slot.slotIndex);
        if (existing !== undefined) {
          return (
            <div
              key={slot.slotIndex}
              className="rounded-md border bg-muted/20 px-3 py-2 text-sm"
            >
              <p>{t('signed', { name: existing.signerName })}</p>
              {slot.label !== undefined ? (
                <p className="text-xs text-muted-foreground">{slot.label}</p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={slot.slotIndex} className="space-y-2 rounded-md border p-3">
            {slot.label !== undefined ? (
              <p className="text-sm font-medium">{slot.label}</p>
            ) : null}
            <SignaturePad
              saving={sign.isPending}
              onSave={({ signatureData, signerName, signerRole }) => {
                sign.mutate({
                  inspectionId: state.inspectionId,
                  slotIndex: slot.slotIndex,
                  slotId: item.id,
                  signatureData,
                  signerName,
                  ...(signerRole !== undefined ? { signerRole } : {}),
                });
              }}
            />
            {readonly ? (
              <p className="text-xs italic text-muted-foreground">{t('sign')}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ReadonlyField({ kind }: { kind: 'conductedBy' | 'inspectionDate' | 'documentNumber' }) {
  const { state } = useConduct();
  let value: string;
  if (kind === 'conductedBy') value = state.conductedByUserId;
  else if (kind === 'inspectionDate') value = state.startedAt.slice(0, 10);
  else value = state.documentNumber ?? '';
  return (
    <Input type="text" value={value} readOnly className="max-w-[24rem] bg-muted/30" />
  );
}
