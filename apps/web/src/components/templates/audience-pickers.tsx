'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';

/**
 * Pickers used by the template Publish tab so the user picks groups and
 * sites by name without ever seeing the underlying access_rule plumbing.
 *
 * Each picker renders:
 *   - the current selection as removable chips
 *   - an "Add …" button that opens a Dialog with a search box and a
 *     checkbox list of every group / site in the tenant
 *   - a "Done" button to commit the dialog selection back to the caller
 *
 * Data comes from `trpc.groups.list` and `trpc.sites.list` — both already
 * filter archived rows server-side.
 */

interface AudienceOption {
  id: string;
  label: string;
}

interface AudiencePickerProps {
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

interface PickerInternalProps extends AudiencePickerProps {
  options: readonly AudienceOption[];
  isLoading: boolean;
  labelText: string;
  emptySelectionText: string;
  addText: string;
}

function AudiencePicker({
  selected,
  onChange,
  options,
  isLoading,
  labelText,
  emptySelectionText,
  addText,
}: PickerInternalProps) {
  const t = useTranslations('templates.editor.publishTab');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draftSelected, setDraftSelected] = useState<string[]>([]);

  const optionById = useMemo(() => {
    const map = new Map<string, AudienceOption>();
    for (const opt of options) map.set(opt.id, opt);
    return map;
  }, [options]);

  const filteredOptions = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return options;
    return options.filter((opt) => opt.label.toLowerCase().includes(needle));
  }, [options, search]);

  function openDialog() {
    setDraftSelected([...selected]);
    setSearch('');
    setOpen(true);
  }

  function toggleDraft(id: string) {
    setDraftSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function commit() {
    onChange(draftSelected);
    setOpen(false);
  }

  function removeChip(id: string) {
    onChange(selected.filter((x) => x !== id));
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{labelText}</span>
        <Button type="button" size="sm" variant="outline" onClick={openDialog} disabled={isLoading}>
          {addText}
        </Button>
      </div>

      {selected.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptySelectionText}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {selected.map((id) => {
            const opt = optionById.get(id);
            const label = opt?.label ?? id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"
              >
                {label}
                <button
                  type="button"
                  onClick={() => removeChip(id)}
                  aria-label={label}
                  className="rounded-full text-muted-foreground hover:text-foreground"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{addText}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pickerSearchPlaceholder')}
              aria-label={t('pickerSearchPlaceholder')}
            />
            <div className="max-h-72 space-y-1 overflow-y-auto rounded-md border p-2">
              {filteredOptions.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">{t('pickerEmpty')}</p>
              ) : (
                filteredOptions.map((opt) => {
                  const checked = draftSelected.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/40"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleDraft(opt.id)}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                      <span className="truncate">{opt.label}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={commit}>
              {t('pickerDone')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function GroupPicker({ selected, onChange }: AudiencePickerProps) {
  const t = useTranslations('templates.editor.publishTab');
  const { data, isLoading } = trpc.groups.list.useQuery();
  const options = useMemo<AudienceOption[]>(
    () => (data ?? []).map((g) => ({ id: g.id, label: g.name })),
    [data],
  );
  return (
    <AudiencePicker
      selected={selected}
      onChange={onChange}
      options={options}
      isLoading={isLoading}
      labelText={t('groupsLabel')}
      emptySelectionText={t('noGroupsSelected')}
      addText={t('addGroups')}
    />
  );
}

export function SitePicker({ selected, onChange }: AudiencePickerProps) {
  const t = useTranslations('templates.editor.publishTab');
  const { data, isLoading } = trpc.sites.list.useQuery();
  const options = useMemo<AudienceOption[]>(
    () => (data ?? []).map((s) => ({ id: s.id, label: s.name })),
    [data],
  );
  return (
    <AudiencePicker
      selected={selected}
      onChange={onChange}
      options={options}
      isLoading={isLoading}
      labelText={t('sitesLabel')}
      emptySelectionText={t('noSitesSelected')}
      addText={t('addSites')}
    />
  );
}
