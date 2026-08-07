'use client';

import { ChevronDown, Filter, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { Button } from './ui/button';
import { Input } from './ui/input';

/**
 * The platform-standard list filter row (ADR 0014 — Inspections is the
 * reference). Layout, left → right: an optional site/attention `leading`
 * slot, a search box, a "+ Add filter" dropdown that reveals filters as
 * removable chips, the active chips, an optional `trailing` slot, and a
 * results count pinned to the right.
 *
 * This is a presentation component: each module keeps owning its filter
 * state and its tRPC query wiring, and passes its filters in as `FilterDef`s.
 * Extracted from the inline Inspections implementation so every module gets
 * the same interaction instead of the five different filter styles the
 * platform had grown (native selects, shadcn selects, pill buttons,
 * search-only, chips).
 */

export type FilterControl =
  | {
      kind: 'select';
      value: string;
      onValueChange: (value: string) => void;
      options: readonly { value: string; label: string }[];
    }
  | {
      kind: 'dateRange';
      from: string;
      to: string;
      onFromChange: (value: string) => void;
      onToChange: (value: string) => void;
    }
  /** A single date (e.g. an "as at" point), not a from/to range. */
  | { kind: 'date'; value: string; onChange: (value: string) => void }
  /**
   * An arbitrary control rendered in place of the chip (e.g. the hierarchical
   * SiteSelector, which is a popover and does not fit the compact inner
   * controls). It supplies its own value display; the bar adds the remove ✕.
   */
  | { kind: 'custom'; render: () => ReactNode }
  /** Presence of the chip is the value — removing the chip turns it off. */
  | { kind: 'boolean' };

export interface FilterDef {
  key: string;
  /** Already-translated chip label / menu entry. */
  label: string;
  control: FilterControl;
}

/**
 * A single filter pill: `Label: <control> ✕`. The colon is dropped for
 * boolean filters, which carry no inner control.
 */
export function FilterChip({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children?: ReactNode;
}) {
  const tCommon = useTranslations('common');
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-1 text-xs">
      <span className="font-medium text-muted-foreground">
        {label}
        {children !== undefined ? ':' : ''}
      </span>
      {children}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={tCommon('removeFilter', { label })}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function ChipControl({ control }: { control: FilterControl }) {
  const tCommon = useTranslations('common');
  if (control.kind === 'select') {
    return (
      <select
        value={control.value}
        onChange={(e) => control.onValueChange(e.target.value)}
        className="max-w-[160px] border-0 bg-transparent text-xs outline-none"
      >
        {control.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (control.kind === 'dateRange') {
    return (
      <span className="flex items-center gap-1">
        <input
          type="date"
          value={control.from}
          onChange={(e) => control.onFromChange(e.target.value)}
          className="border-0 bg-transparent text-xs outline-none"
          aria-label={tCommon('from')}
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="date"
          value={control.to}
          onChange={(e) => control.onToChange(e.target.value)}
          className="border-0 bg-transparent text-xs outline-none"
          aria-label={tCommon('to')}
        />
      </span>
    );
  }
  if (control.kind === 'date') {
    return (
      <input
        type="date"
        value={control.value}
        onChange={(e) => control.onChange(e.target.value)}
        className="border-0 bg-transparent text-xs outline-none"
      />
    );
  }
  return null;
}

export function FilterBar({
  search,
  filters,
  activeKeys,
  onAddFilter,
  onRemoveFilter,
  resultsCount,
  resultsSuffix,
  leading,
  trailing,
  className,
}: {
  search?: { value: string; onChange: (value: string) => void; placeholder: string };
  filters: readonly FilterDef[];
  /** Active filter keys, in display order. */
  activeKeys: readonly string[];
  onAddFilter: (key: string) => void;
  onRemoveFilter: (key: string) => void;
  /** When set, renders "{count} results" (common.resultsCount) pinned right. */
  resultsCount?: number;
  /** Appended after the count (e.g. Inspections' " / {total}" during search). */
  resultsSuffix?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  const tCommon = useTranslations('common');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeSet = new Set(activeKeys);
  const inactive = filters.filter((f) => !activeSet.has(f.key));
  const byKey = new Map(filters.map((f) => [f.key, f]));

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {leading}

      {search !== undefined ? (
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            className="pl-8"
          />
        </div>
      ) : null}

      {filters.length > 0 ? (
        <div className="relative" ref={menuRef}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMenuOpen((v) => !v)}
            className="gap-1.5"
          >
            <Filter className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tCommon('addFilter')}</span>
            {activeKeys.length > 0 ? (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                {activeKeys.length}
              </span>
            ) : (
              <ChevronDown className="hidden h-3 w-3 text-muted-foreground sm:block" />
            )}
          </Button>
          {menuOpen && inactive.length > 0 ? (
            <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-md border bg-popover py-1 shadow-lg">
              {inactive.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => {
                    onAddFilter(f.key);
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center px-3 py-2 text-sm hover:bg-accent"
                >
                  {f.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeKeys.map((key) => {
        const def = byKey.get(key);
        if (def === undefined) return null;
        // A custom control (e.g. SiteSelector) renders itself; the bar only
        // labels it and adds the remove ✕, rather than wrapping it in a pill.
        if (def.control.kind === 'custom') {
          const render = def.control.render;
          return (
            <div key={key} className="inline-flex items-center gap-1">
              {render()}
              <button
                type="button"
                onClick={() => onRemoveFilter(key)}
                className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={tCommon('removeFilter', { label: def.label })}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        }
        return (
          <FilterChip key={key} label={def.label} onRemove={() => onRemoveFilter(key)}>
            {def.control.kind === 'boolean' ? undefined : <ChipControl control={def.control} />}
          </FilterChip>
        );
      })}

      {trailing}

      {resultsCount !== undefined ? (
        <span className="ml-auto text-sm text-muted-foreground">
          {tCommon('resultsCount', { count: resultsCount })}
          {resultsSuffix}
        </span>
      ) : null}
    </div>
  );
}
