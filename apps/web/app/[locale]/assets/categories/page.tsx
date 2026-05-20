'use client';

/**
 * Asset categories management page.
 *
 * Lists all asset types (categories) and lets admins:
 *  1. Create a new category (name + description).
 *  2. Edit a category inline — rename, change description, manage custom fields.
 *  3. Archive a category (blocked when active assets reference it — AS-E12).
 *
 * Custom field builder supports: text, number, date, select (with options).
 */
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { FocusedPageShell } from '../../../../src/components/focused-page-shell';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { Textarea } from '../../../../src/components/ui/textarea';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

// ─── Types ───────────────────────────────────────────────────────────────────

type FieldType = 'text' | 'number' | 'date' | 'select';

interface CustomField {
  id: string;
  name: string;
  fieldType: FieldType;
  options?: string[];
  required?: boolean;
}

// Generate a simple client-side ID for new fields before they're saved.
function newFieldId(): string {
  return `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Field type pill ─────────────────────────────────────────────────────────

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Select',
};

// ─── Custom field editor row ──────────────────────────────────────────────────

function FieldRow({
  field,
  onChange,
  onRemove,
}: {
  field: CustomField;
  onChange: (updated: CustomField) => void;
  onRemove: () => void;
}) {
  const tF = useTranslations('assets.categories.fields');
  const [optionsText, setOptionsText] = useState(() => (field.options ?? []).join('\n'));

  function handleOptionsBlur() {
    const opts = optionsText
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);
    onChange({ ...field, options: opts });
  }

  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <GripVertical className="mt-2 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />

        <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
          {/* Field name */}
          <Input
            value={field.name}
            onChange={(e) => onChange({ ...field, name: e.target.value })}
            placeholder={tF('namePlaceholder')}
            className="text-sm"
          />

          {/* Type selector */}
          <select
            value={field.fieldType}
            onChange={(e) =>
              onChange({ ...field, fieldType: e.target.value as FieldType, options: [] })
            }
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            aria-label={tF('typeLabel')}
          >
            {(['text', 'number', 'date', 'select'] as const).map((ft) => (
              <option key={ft} value={ft}>
                {FIELD_TYPE_LABELS[ft]}
              </option>
            ))}
          </select>

          {/* Required toggle */}
          <label className="flex cursor-pointer items-center gap-1.5 text-sm whitespace-nowrap">
            <input
              type="checkbox"
              checked={field.required === true}
              onChange={(e) => onChange({ ...field, required: e.target.checked })}
              className="h-4 w-4 rounded border-input"
            />
            {tF('requiredLabel')}
          </label>

          {/* Remove */}
          <button
            type="button"
            onClick={onRemove}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={tF('removeButton')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Options editor for select type */}
      {field.fieldType === 'select' ? (
        <div className="ml-7 space-y-1">
          <Label className="text-xs text-muted-foreground">{tF('optionsLabel')}</Label>
          <Textarea
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            onBlur={handleOptionsBlur}
            placeholder={tF('optionsPlaceholder')}
            rows={3}
            className="text-sm font-mono"
          />
        </div>
      ) : null}
    </div>
  );
}

// ─── Category row (collapsed → expanded editor) ───────────────────────────────

function CategoryRow({
  type,
  canManage,
  onSaved,
  onArchived,
}: {
  type: {
    id: string;
    name: string;
    description: string;
    customFields: unknown;
    archivedAt: Date | string | null;
  };
  canManage: boolean;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const tCommon = useTranslations('common');
  const tCat = useTranslations('assets.categories');
  const [open, setOpen] = useState(false);
  const [editName, setEditName] = useState(type.name);
  const [editDesc, setEditDesc] = useState(type.description);
  const [fields, setFields] = useState<CustomField[]>(() => {
    const raw = type.customFields;
    return Array.isArray(raw) ? (raw as CustomField[]) : [];
  });
  const [saving, setSaving] = useState(false);

  const update = trpc.assetTypes.update.useMutation({
    onSuccess: () => {
      toast.success('Category saved');
      setSaving(false);
      onSaved();
    },
    onError: (err) => {
      toast.error(err.message.length > 0 ? err.message : tCommon('error'));
      setSaving(false);
    },
  });

  const archive = trpc.assetTypes.archive.useMutation({
    onSuccess: () => {
      toast.success('Category archived');
      onArchived();
    },
    onError: (err) => {
      const msg = err.message;
      const assetCount = msg.includes('asset-type-has-active-assets:')
        ? msg.split(':')[1]
        : null;
      toast.error(
        assetCount !== null
          ? `Cannot archive: ${assetCount} active asset(s) use this category.`
          : (err.message.length > 0 ? err.message : tCommon('error')),
      );
    },
  });

  const fieldCount = fields.length;

  function addField() {
    setFields((prev) => [
      ...prev,
      { id: newFieldId(), name: '', fieldType: 'text', required: false },
    ]);
  }

  function updateField(idx: number, updated: CustomField) {
    setFields((prev) => prev.map((f, i) => (i === idx ? updated : f)));
  }

  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (editName.trim().length === 0) {
      toast.error('Category name is required');
      return;
    }
    // Validate fields.
    for (const f of fields) {
      if (f.name.trim().length === 0) {
        toast.error('All fields must have a name');
        return;
      }
      if (f.fieldType === 'select' && (f.options ?? []).length === 0) {
        toast.error(`Select field "${f.name}" needs at least one option`);
        return;
      }
    }
    setSaving(true);
    update.mutate({
      typeId: type.id,
      name: editName.trim(),
      description: editDesc.trim(),
      customFields: fields.map((f) => ({
        id: f.id,
        name: f.name.trim(),
        fieldType: f.fieldType,
        options: f.fieldType === 'select' ? (f.options ?? []) : undefined,
        required: f.required ?? false,
      })),
    });
  }

  function handleArchive() {
    if (!window.confirm('Archive this category? Active assets will keep their data.')) return;
    archive.mutate({ typeId: type.id });
  }

  return (
    <div className="border-b last:border-0">
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 font-medium text-sm">{type.name}</span>
        {type.description.length > 0 ? (
          <span className="hidden text-xs text-muted-foreground sm:block max-w-xs truncate">
            {type.description}
          </span>
        ) : null}
        <span className="ml-3 shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {fieldCount} {fieldCount === 1 ? 'field' : 'fields'}
        </span>
      </button>

      {/* Expanded editor */}
      {open ? (
        <div className="border-t bg-muted/10 px-4 pb-5 pt-4 space-y-5">
          {/* Name + description */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`cat-name-${type.id}`}>{tCommon('name')}</Label>
              <Input
                id={`cat-name-${type.id}`}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={200}
                disabled={!canManage}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cat-desc-${type.id}`}>{tCommon('description')}</Label>
              <Input
                id={`cat-desc-${type.id}`}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={5000}
                placeholder={tCat('edit.namePlaceholder')}
                disabled={!canManage}
              />
            </div>
          </div>

          {/* Custom fields */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Custom fields</p>
              {canManage ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addField}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add field
                </Button>
              ) : null}
            </div>

            {fields.length === 0 ? (
              <p className="rounded-lg border border-dashed py-6 text-center text-sm text-muted-foreground">
                No custom fields yet.{' '}
                {canManage ? 'Click "Add field" to define what data to collect for each asset.' : ''}
              </p>
            ) : (
              <div className="space-y-2">
                {fields.map((field, idx) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    onChange={(updated) => updateField(idx, updated)}
                    onRemove={() => removeField(idx)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          {canManage ? (
            <div className="flex items-center justify-between border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleArchive}
                disabled={archive.isPending}
              >
                {archive.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                )}
                Archive category
              </Button>

              <Button
                type="button"
                onClick={handleSave}
                disabled={saving || editName.trim().length === 0}
                size="sm"
              >
                {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Save changes
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AssetCategoriesPage() {
  const t = useTranslations('assets.categories');
  const tCommon = useTranslations('common');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const canManage = useHasPermission('assets.manage');
  const utils = trpc.useUtils();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newFields, setNewFields] = useState<CustomField[]>([]);
  const [search, setSearch] = useState('');

  const { data, isLoading } = trpc.assetTypes.list.useQuery({ includeArchived: false });
  const types = data ?? [];

  const filtered = search.trim().length > 0
    ? types.filter((tp) => tp.name.toLowerCase().includes(search.toLowerCase()))
    : types;

  const create = trpc.assetTypes.create.useMutation({
    onSuccess: () => {
      toast.success(t('create.createdToast'));
      setNewName('');
      setNewDesc('');
      setNewFields([]);
      setShowCreate(false);
      void utils.assetTypes.list.invalidate();
    },
    onError: (err) => toast.error(err.message.length > 0 ? err.message : tCommon('error')),
  });

  function handleCreate() {
    if (newName.trim().length === 0) return;
    for (const f of newFields) {
      if (f.name.trim().length === 0) {
        toast.error('All fields must have a name');
        return;
      }
      if (f.fieldType === 'select' && (f.options ?? []).length === 0) {
        toast.error(`Select field "${f.name}" needs at least one option`);
        return;
      }
    }
    create.mutate({
      name: newName.trim(),
      description: newDesc.trim(),
      customFields: newFields.map((f) => ({
        id: f.id,
        name: f.name.trim(),
        fieldType: f.fieldType,
        options: f.fieldType === 'select' ? (f.options ?? []) : undefined,
        required: f.required ?? false,
      })),
    });
  }

  function addNewField() {
    setNewFields((prev) => [
      ...prev,
      { id: newFieldId(), name: '', fieldType: 'text', required: false },
    ]);
  }

  return (
    <FocusedPageShell title={t('title')} backHref={`/${locale}/assets`} width="wide">
      <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canManage ? (
          <Button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setNewName('');
              setNewDesc('');
              setNewFields([]);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('newButton')}
          </Button>
        ) : null}
      </div>

      {/* Create panel */}
      {showCreate && canManage ? (
        <Card>
          <CardContent className="p-5 space-y-5">
            <h2 className="text-base font-semibold">{t('create.title')}</h2>

            {/* Name + description */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-cat-name">Name <span className="text-destructive">*</span></Label>
                <Input
                  id="new-cat-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={200}
                  placeholder={t('create.namePlaceholder')}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-cat-desc">Description</Label>
                <Input
                  id="new-cat-desc"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  maxLength={5000}
                  placeholder="Optional"
                />
              </div>
            </div>

            {/* Custom fields for new category */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Custom fields</p>
                <Button type="button" variant="outline" size="sm" onClick={addNewField}>
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add field
                </Button>
              </div>
              {newFields.length > 0 ? (
                <div className="space-y-2">
                  {newFields.map((field, idx) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      onChange={(updated) =>
                        setNewFields((prev) => prev.map((f, i) => (i === idx ? updated : f)))
                      }
                      onRemove={() => setNewFields((prev) => prev.filter((_, i) => i !== idx))}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
                  No fields yet — you can add them now or after creating the category.
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowCreate(false)}
              >
                {tCommon('cancel')}
              </Button>
              <Button
                type="button"
                disabled={create.isPending || newName.trim().length === 0}
                onClick={handleCreate}
              >
                {create.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                {t('create.submitButton')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Search */}
      {!isLoading && types.length > 3 ? (
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="max-w-xs"
        />
      ) : null}

      {/* Category list */}
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <p className="text-sm font-medium text-muted-foreground">{t('empty')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('emptySubtitle')}</p>
            {canManage ? (
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() => setShowCreate(true)}
              >
                <Plus className="mr-1 h-4 w-4" />
                {t('newButton')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {filtered.map((tp) => (
              <CategoryRow
                key={tp.id}
                type={tp}
                canManage={canManage}
                onSaved={() => void utils.assetTypes.list.invalidate()}
                onArchived={() => void utils.assetTypes.list.invalidate()}
              />
            ))}
          </CardContent>
        </Card>
      )}
      </div>
    </FocusedPageShell>
  );
}
