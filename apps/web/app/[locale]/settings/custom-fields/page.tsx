'use client';

import { newId } from '@forma360/shared/id';
import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../src/components/ui/dialog';
import { Input } from '../../../../src/components/ui/input';
import { Label } from '../../../../src/components/ui/label';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { useHasPermission } from '../../../../src/lib/permissions-context';
import { trpc } from '../../../../src/lib/trpc/client';

type FieldType = 'text' | 'select' | 'multi_select';
type OptionDraft = { id: string; label: string };

const FIELD_TYPE_KEYS: Record<string, string> = {
  text: 'customFields.type_text',
  select: 'customFields.type_select',
  multi_select: 'customFields.type_multi_select',
};

function isSelectType(type: string): boolean {
  return type === 'select' || type === 'multi_select';
}

export default function CustomFieldsPage() {
  const t = useTranslations('settings');
  const canManage = useHasPermission('users.customFields.manage');
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.customFields.list.useQuery();
  const fields = data ?? [];

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createType, setCreateType] = useState<FieldType>('text');
  const [createRequired, setCreateRequired] = useState(false);
  const [createOptions, setCreateOptions] = useState<OptionDraft[]>([{ id: newId(), label: '' }]);

  // Edit dialog state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editType, setEditType] = useState<FieldType>('text');
  const [editName, setEditName] = useState('');
  const [editRequired, setEditRequired] = useState(false);
  const [editOptions, setEditOptions] = useState<OptionDraft[]>([{ id: newId(), label: '' }]);

  const createField = trpc.customFields.create.useMutation({
    onSuccess: () => {
      void utils.customFields.list.invalidate();
      setShowCreate(false);
      toast.success(t('customFields.createSuccess'));
    },
    onError: (err) => toast.error(err.message || t('customFields.createError')),
  });

  const updateField = trpc.customFields.update.useMutation({
    onSuccess: () => {
      void utils.customFields.list.invalidate();
      setEditingId(null);
      toast.success(t('customFields.editSuccess'));
    },
    onError: (err) => toast.error(err.message || t('customFields.editError')),
  });

  const deleteField = trpc.customFields.delete.useMutation({
    onSuccess: () => {
      void utils.customFields.list.invalidate();
      toast.success(t('customFields.deleteSuccess'));
    },
    onError: (err) => toast.error(err.message),
  });

  function openCreate() {
    setCreateName('');
    setCreateType('text');
    setCreateRequired(false);
    setCreateOptions([{ id: newId(), label: '' }]);
    setShowCreate(true);
  }

  function openEdit(field: {
    id: string;
    name: string;
    type: string;
    required: string;
    options: ReadonlyArray<{ id: string; label: string }>;
  }) {
    const type: FieldType =
      field.type === 'select' || field.type === 'multi_select' ? field.type : 'text';
    setEditingId(field.id);
    setEditType(type);
    setEditName(field.name);
    setEditRequired(field.required === 'true');
    setEditOptions(
      field.options.length > 0
        ? field.options.map((o) => ({ id: o.id, label: o.label }))
        : [{ id: newId(), label: '' }],
    );
  }

  const createOptionsValid =
    !isSelectType(createType) || createOptions.every((o) => o.label.trim().length > 0);
  const editOptionsValid =
    !isSelectType(editType) || editOptions.every((o) => o.label.trim().length > 0);

  function submitCreate() {
    const name = createName.trim();
    if (!name || !createOptionsValid) return;
    createField.mutate({
      name,
      type: createType,
      required: createRequired,
      order: fields.length,
      ...(isSelectType(createType)
        ? { options: createOptions.map((o) => ({ id: o.id, label: o.label.trim() })) }
        : {}),
    });
  }

  function submitEdit() {
    const name = editName.trim();
    if (editingId === null || !name || !editOptionsValid) return;
    updateField.mutate({
      id: editingId,
      name,
      required: editRequired,
      ...(isSelectType(editType)
        ? { options: editOptions.map((o) => ({ id: o.id, label: o.label.trim() })) }
        : {}),
    });
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('customFields.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('customFields.subtitle')}</p>
        </div>
        {canManage ? (
          <Button onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            {t('customFields.createButton')}
          </Button>
        ) : null}
      </header>

      <Card>
        <CardContent className="p-0">
          {/* ── Desktop table ─────────────────────────────────────────────── */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium">{t('customFields.colName')}</th>
                  <th className="px-4 py-3 font-medium">{t('customFields.colType')}</th>
                  <th className="px-4 py-3 font-medium">{t('customFields.colRequired')}</th>
                  <th className="px-4 py-3 font-medium">{t('customFields.colOptions')}</th>
                  {canManage ? (
                    <th className="px-4 py-3 text-right font-medium">{t('groups.table.actions')}</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="p-4">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td
                      colSpan={canManage ? 5 : 4}
                      className="px-4 py-10 text-center text-sm text-destructive"
                    >
                      {t('customFields.loadError')}
                    </td>
                  </tr>
                ) : fields.length === 0 ? (
                  <tr>
                    <td colSpan={canManage ? 5 : 4} className="px-4 py-10 text-center">
                      <p className="text-muted-foreground">{t('customFields.empty')}</p>
                      {canManage ? (
                        <Button className="mt-4" size="sm" onClick={openCreate}>
                          <Plus className="mr-1.5 h-4 w-4" />
                          {t('customFields.createButton')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ) : (
                  fields.map((f) => {
                    const typeKey = FIELD_TYPE_KEYS[f.type];
                    return (
                    <tr key={f.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{f.name}</td>
                      <td className="px-4 py-3">{typeKey ? t(typeKey) : f.type}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {f.required === 'true'
                          ? t('customFields.requiredYes')
                          : t('customFields.requiredNo')}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {isSelectType(f.type) ? f.options.length : '—'}
                      </td>
                      {canManage ? (
                        <td className="flex items-center justify-end gap-1 px-4 py-3">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(f)}>
                            {t('customFields.editButton')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => {
                              if (window.confirm(t('customFields.deleteConfirm'))) {
                                deleteField.mutate({ id: f.id });
                              }
                            }}
                            disabled={deleteField.isPending}
                          >
                            {t('customFields.deleteButton')}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* ── Mobile card list ──────────────────────────────────────────── */}
          <div className="md:hidden">
            {isLoading ? (
              <div className="p-4">
                <Skeleton className="h-24 w-full" />
              </div>
            ) : error ? (
              <p className="px-4 py-10 text-center text-sm text-destructive">
                {t('customFields.loadError')}
              </p>
            ) : fields.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">{t('customFields.empty')}</p>
                {canManage ? (
                  <Button className="mt-4" size="sm" onClick={openCreate}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    {t('customFields.createButton')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <ul className="divide-y">
                {fields.map((f) => {
                  const typeKey = FIELD_TYPE_KEYS[f.type];
                  return (
                  <li key={f.id} className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{f.name}</p>
                      <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {typeKey ? t(typeKey) : f.type}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {f.required === 'true'
                        ? t('customFields.requiredYes')
                        : t('customFields.requiredNo')}
                      {isSelectType(f.type) ? ` · ${f.options.length}` : ''}
                    </p>
                    {canManage ? (
                      <div className="flex flex-wrap items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(f)}>
                          {t('customFields.editButton')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (window.confirm(t('customFields.deleteConfirm'))) {
                              deleteField.mutate({ id: f.id });
                            }
                          }}
                          disabled={deleteField.isPending}
                        >
                          {t('customFields.deleteButton')}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Create dialog ───────────────────────────────────────────────── */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('customFields.createTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="cf-name">{t('customFields.nameLabel')}</Label>
              <Input
                id="cf-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cf-type">{t('customFields.typeLabel')}</Label>
              <select
                id="cf-type"
                value={createType}
                onChange={(e) => setCreateType(e.target.value as FieldType)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="text">{t('customFields.type_text')}</option>
                <option value="select">{t('customFields.type_select')}</option>
                <option value="multi_select">{t('customFields.type_multi_select')}</option>
              </select>
            </div>
            {isSelectType(createType) ? (
              <OptionsEditor
                options={createOptions}
                onChange={setCreateOptions}
                disabled={createField.isPending}
                labels={{
                  optionsLabel: t('customFields.optionsLabel'),
                  addOption: t('customFields.addOption'),
                  removeOption: t('customFields.removeOption'),
                  optionPlaceholder: t('customFields.optionPlaceholder'),
                }}
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={createRequired}
                onChange={(e) => setCreateRequired(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              {t('customFields.requiredLabel')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {t('customFields.cancel')}
            </Button>
            <Button
              onClick={submitCreate}
              disabled={!createName.trim() || !createOptionsValid || createField.isPending}
            >
              {t('customFields.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit dialog ─────────────────────────────────────────────────── */}
      <Dialog
        open={editingId !== null}
        onOpenChange={(o) => {
          if (!o) setEditingId(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('customFields.editTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ecf-name">{t('customFields.nameLabel')}</Label>
              <Input
                id="ecf-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('customFields.typeLabel')}</Label>
              <p className="text-sm text-muted-foreground">{t(FIELD_TYPE_KEYS[editType] ?? '')}</p>
            </div>
            {isSelectType(editType) ? (
              <OptionsEditor
                options={editOptions}
                onChange={setEditOptions}
                disabled={updateField.isPending}
                labels={{
                  optionsLabel: t('customFields.optionsLabel'),
                  addOption: t('customFields.addOption'),
                  removeOption: t('customFields.removeOption'),
                  optionPlaceholder: t('customFields.optionPlaceholder'),
                }}
              />
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editRequired}
                onChange={(e) => setEditRequired(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              {t('customFields.requiredLabel')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingId(null)}>
              {t('customFields.cancel')}
            </Button>
            <Button
              onClick={submitEdit}
              disabled={!editName.trim() || !editOptionsValid || updateField.isPending}
            >
              {t('customFields.editSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OptionsEditor({
  options,
  onChange,
  disabled,
  labels,
}: {
  options: OptionDraft[];
  onChange: (next: OptionDraft[]) => void;
  disabled: boolean;
  labels: {
    optionsLabel: string;
    addOption: string;
    removeOption: string;
    optionPlaceholder: string;
  };
}) {
  function updateLabel(index: number, value: string) {
    onChange(options.map((o, i) => (i === index ? { ...o, label: value } : o)));
  }
  function removeAt(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...options, { id: newId(), label: '' }]);
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <Label className="text-xs text-muted-foreground">{labels.optionsLabel}</Label>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={opt.id} className="flex items-center gap-2">
            <Input
              value={opt.label}
              onChange={(e) => updateLabel(i, e.target.value)}
              placeholder={labels.optionPlaceholder}
              maxLength={120}
              disabled={disabled}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeAt(i)}
              disabled={disabled || options.length <= 1}
              aria-label={labels.removeOption}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
        <Plus className="mr-1 h-4 w-4" />
        {labels.addOption}
      </Button>
    </div>
  );
}
