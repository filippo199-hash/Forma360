'use client';

import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export interface SearchSelectOption {
  id: string;
  label: string;
  /** Secondary line (reference number, email, …) — also searched. */
  sub?: string | null;
}

export interface SearchSelectProps {
  /** Selected option id, or null. */
  value: string | null;
  onChange: (next: string | null) => void;
  options: readonly SearchSelectOption[];
  label?: string;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  /** Allow clearing back to "none" from inside the popover (default true). */
  clearable?: boolean;
}

/**
 * Platform-style single-select with a search bar — the same popover
 * pattern as {@link SiteSelector} / {@link GroupUserSelector}, for flat
 * entity lists that grow into the hundreds (risk assessments, documents).
 * Type to refine, pick one, Done.
 */
export function SearchSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  disabled = false,
  className,
  clearable = true,
}: SearchSelectProps) {
  const t = useTranslations('entitySelect');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<string | null>(null);

  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const selected = value !== null ? byId.get(value) : undefined;

  function openPopover() {
    setDraft(value);
    setSearch('');
    setOpen(true);
  }

  function commit() {
    onChange(draft);
    setOpen(false);
  }

  const needle = search.trim().toLowerCase();
  const filtered =
    needle.length > 0
      ? options.filter(
          (o) =>
            o.label.toLowerCase().includes(needle) || (o.sub ?? '').toLowerCase().includes(needle),
        )
      : options;

  return (
    <div className={cn('space-y-1', className)}>
      {label !== undefined ? <span className="text-sm font-medium">{label}</span> : null}

      <Popover open={open} onOpenChange={(o) => (o ? openPopover() : setOpen(false))}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40 disabled:opacity-50"
          >
            <span className={cn('truncate', selected === undefined && 'text-muted-foreground')}>
              {selected !== undefined ? selected.label : placeholder}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-80 p-0" align="start">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
            {search !== '' ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t('clearSearch')}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('noResults')}
              </p>
            ) : (
              filtered.map((option) => {
                const checked = draft === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setDraft(checked ? null : option.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{option.label}</span>
                      {option.sub !== undefined && option.sub !== null && option.sub !== '' ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {option.sub}
                        </span>
                      ) : null}
                    </span>
                    {checked ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            {clearable ? (
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                {t('clear')}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={commit}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              {t('done')}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
