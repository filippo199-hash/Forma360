'use client';

import type { CustomResponseSet, Item } from '@forma360/shared/template-schema';
import { Image as ImageIcon, MapPin, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Textarea } from '../ui/textarea';
import { trpc } from '../../lib/trpc/client';
import { AssetPickerInput } from './asset-picker-input';
import { useConduct } from './conduct-context';
import { InstructionBody } from './instruction-render';
import { SignaturePad } from './signature-pad';

/**
 * Tailwind classes for a multiple-choice option chip, tinted by the option's
 * `color` (green / amber / red / grey) and intensified when selected. Unknown
 * or absent colours fall back to the neutral primary-accent treatment.
 */
function optionColorClass(color: string | undefined, selected: boolean): string {
  const map: Record<string, { base: string; sel: string }> = {
    green: {
      base: 'border-green-200 bg-green-50/50 dark:border-green-900/50 dark:bg-green-950/20',
      sel: 'border-green-500 bg-green-100 dark:border-green-600 dark:bg-green-900/40',
    },
    amber: {
      base: 'border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20',
      sel: 'border-amber-500 bg-amber-100 dark:border-amber-600 dark:bg-amber-900/40',
    },
    red: {
      base: 'border-red-200 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20',
      sel: 'border-red-500 bg-red-100 dark:border-red-600 dark:bg-red-900/40',
    },
    grey: { base: 'border-border bg-muted/30', sel: 'border-foreground/40 bg-muted' },
  };
  const c = color !== undefined ? map[color] : undefined;
  if (c === undefined) return selected ? 'border-primary bg-accent' : 'border-border bg-background';
  return selected ? c.sel : c.base;
}

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
      return <ConductedByField />;
    case 'inspectionDate':
      return <ReadonlyField kind="inspectionDate" />;
    case 'documentNumber':
      return <ReadonlyField kind="documentNumber" />;
    case 'site':
      return <SitePickerInput item={item} readonly={readonly} />;
    case 'asset':
      return <AssetPickerInput item={item} readonly={readonly} />;
    case 'location':
      return <LocationInput item={item} readonly={readonly} />;
    case 'company':
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

function SitePickerInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'site' }>;
  readonly: boolean;
}) {
  const t = useTranslations('inspections.conduct.response.site');
  const { state, dispatch } = useConduct();
  const sitesQuery = trpc.sites.listForConductor.useQuery();
  const [search, setSearch] = useState('');

  const allSites = sitesQuery.data ?? [];

  const filtered = useMemo(
    () =>
      search.trim() === ''
        ? allSites
        : allSites.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())),
    [allSites, search],
  );

  const raw = state.responses[item.id];
  const value = typeof raw === 'string' ? raw : '';
  const selectedSite = allSites.find((s) => s.id === value);

  function handleSelect(siteId: string) {
    dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: siteId });
  }

  if (sitesQuery.isPending) {
    return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  }

  if (allSites.length === 0) {
    return <p className="text-sm italic text-muted-foreground">{t('noSites')}</p>;
  }

  return (
    <div className="max-w-sm space-y-1">
      <Select value={value} onValueChange={handleSelect} disabled={readonly}>
        <SelectTrigger aria-label={item.prompt}>
          <SelectValue placeholder={t('placeholder')}>
            {selectedSite !== undefined ? selectedSite.name : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {/* Search box inside the dropdown */}
          <div className="px-2 pb-1 pt-2">
            <Input
              placeholder={t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => e.stopPropagation()}
            />
          </div>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">{t('noResults')}</p>
          ) : (
            filtered.map((site) => (
              <SelectItem key={site.id} value={site.id}>
                {/* Indent child sites to show hierarchy */}
                <span
                  style={site.depth > 0 ? { paddingLeft: `${site.depth * 12}px` } : undefined}
                  className="block"
                >
                  {site.name}
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Location field. Stores a free-text value (address or "lat, lng") so it
 * works without a maps provider, and offers a one-tap "Use current
 * location" button that fills the device's GPS coordinates via the
 * browser geolocation API — the "default current location" behaviour.
 */
function LocationInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'location' }>;
  readonly: boolean;
}) {
  const t = useTranslations('inspections.conduct.response.location');
  const { state, dispatch } = useConduct();
  const [locating, setLocating] = useState(false);
  const raw = state.responses[item.id];
  const value = typeof raw === 'string' ? raw : '';

  function capture() {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      toast.error(t('unsupported'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: coords });
        setLocating(false);
      },
      () => {
        toast.error(t('error'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <div className="flex max-w-md items-center gap-2">
      <Input
        type="text"
        value={value}
        onChange={(e) => dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: e.target.value })}
        disabled={readonly}
        placeholder={t('placeholder')}
        aria-label={item.prompt}
      />
      <button
        type="button"
        onClick={capture}
        disabled={readonly || locating}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
      >
        <MapPin className="h-4 w-4" />
        <span>{locating ? t('capturing') : t('capture')}</span>
      </button>
    </div>
  );
}

function TextInput({
  item,
  readonly,
}: {
  item: Extract<Item, { type: 'text' }>;
  readonly: boolean;
}) {
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
        <p className="text-xs text-muted-foreground">{t('charsRemaining', { count: remaining })}</p>
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
      <p className="text-xs text-muted-foreground">{t('charsRemaining', { count: remaining })}</p>
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
          onChange={(e) =>
            dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: e.target.value })
          }
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
  const inputType =
    item.type === 'date' ? 'date' : item.type === 'time' ? 'time' : 'datetime-local';
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
            <label
              className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${optionColorClass(
                option.color,
                isSelected,
              )}`}
            >
              <input
                type={set.multiSelect ? 'checkbox' : 'radio'}
                name={item.id}
                checked={isSelected}
                onChange={() =>
                  set.multiSelect ? toggleMulti(option.id) : toggleSingle(option.id)
                }
                disabled={readonly}
                className="h-5 w-5"
              />
              <span className="font-medium">{option.label}</span>
              {option.flagged ? (
                <span className="ml-auto rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-200">
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
        onChange={(e) =>
          dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: e.target.checked })
        }
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
        onChange={(e) =>
          dispatch({ type: 'SET_RESPONSE', itemId: item.id, value: Number(e.target.value) })
        }
        disabled={readonly}
        className="w-full"
        aria-label={item.prompt}
      />
      <p className="text-sm text-muted-foreground">{t('value', { value })}</p>
    </div>
  );
}

/**
 * Thumbnail for a single uploaded media item. Attempts to render the key
 * as an image via the files proxy; falls back to a generic icon if the
 * response is not an image (videos, PDFs, etc.).
 */
function MediaThumb({ storageKey }: { storageKey: string }) {
  const [imgError, setImgError] = useState(false);
  const src = `/api/files?key=${encodeURIComponent(storageKey)}`;
  const filename = storageKey.split('/').at(-1) ?? storageKey;

  if (!imgError) {
    return (
      <div className="aspect-square overflow-hidden rounded-md border bg-muted">
        <img
          src={src}
          alt={filename}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      </div>
    );
  }

  return (
    <div className="flex aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-md border bg-muted text-muted-foreground">
      <ImageIcon className="h-6 w-6" />
      <span className="max-w-full truncate px-1 text-xs">{filename}</span>
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
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {keys.map((k) => (
            <li key={k} className="group relative">
              <MediaThumb storageKey={k} />
              {!readonly ? (
                <button
                  type="button"
                  aria-label={t('remove')}
                  onClick={() => remove(k)}
                  className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5 text-muted-foreground opacity-0 shadow transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
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
            <div key={slot.slotIndex} className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <p>{t('signed', { name: existing.signerName })}</p>
              {slot.label !== undefined ? (
                <p className="text-xs text-muted-foreground">{slot.label}</p>
              ) : null}
            </div>
          );
        }
        return (
          <div key={slot.slotIndex} className="space-y-2 rounded-md border p-3">
            {slot.label !== undefined ? <p className="text-sm font-medium">{slot.label}</p> : null}
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
            {readonly ? <p className="text-xs italic text-muted-foreground">{t('sign')}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function ReadonlyField({ kind }: { kind: 'inspectionDate' | 'documentNumber' }) {
  const { state } = useConduct();
  const value =
    kind === 'inspectionDate' ? state.startedAt.slice(0, 10) : (state.documentNumber ?? '');
  return <Input type="text" value={value} readOnly className="max-w-[24rem] bg-muted/30" />;
}

/**
 * "Prepared by" / conducted-by field. The conduct state only carries the
 * user id, so we resolve it to a human name via the users list and fall
 * back to the id while loading or if the user is no longer listed.
 */
function ConductedByField() {
  const { state } = useConduct();
  const usersQuery = trpc.users.list.useQuery({ limit: 200 });
  const user = usersQuery.data?.users.find((u) => u.id === state.conductedByUserId);
  const display =
    user !== undefined ? (user.name !== '' ? user.name : user.email) : state.conductedByUserId;
  return <Input type="text" value={display} readOnly className="max-w-[24rem] bg-muted/30" />;
}
