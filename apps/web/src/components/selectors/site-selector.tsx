'use client';

import { Check, ChevronLeft, ChevronRight, MapPin, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

interface SiteLite {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
}

export interface SiteSelectorProps {
  /** Selected site ids. In single mode this holds 0 or 1 id. */
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Multi-select (default) vs single-select. */
  multiple?: boolean;
  /** Optional field label rendered above the control. */
  label?: string;
  /** Placeholder for the trigger when nothing is selected. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Optional predicate to restrict which sites are selectable/visible
   * (e.g. exclude the site being edited, or enforce a max parent depth).
   * A site filtered out here is removed from the tree entirely.
   */
  filterSite?: (site: SiteLite) => boolean;
}

/**
 * Platform-wide site selector. A searchable, hierarchical (parent → child)
 * picker with multi-select. Click a site to (de)select it; use the ›
 * affordance to drill into its children; "View all" flattens the whole tree.
 * Selections show as removable chips (multi) or the chosen name (single).
 */
export function SiteSelector({
  value,
  onChange,
  multiple = true,
  label,
  placeholder = 'Select site',
  disabled = false,
  className,
  filterSite,
}: SiteSelectorProps) {
  const { data } = trpc.sites.list.useQuery();
  const sites = useMemo<SiteLite[]>(() => {
    const mapped = (data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      parentId: s.parentId,
      depth: s.depth,
    }));
    return filterSite ? mapped.filter(filterSite) : mapped;
  }, [data, filterSite]);

  const byId = useMemo(() => {
    const m = new Map<string, SiteLite>();
    for (const s of sites) m.set(s.id, s);
    return m;
  }, [sites]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, SiteLite[]>();
    for (const s of sites) {
      const list = m.get(s.parentId) ?? [];
      list.push(s);
      m.set(s.parentId, list);
    }
    return m;
  }, [sites]);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<string | null>(null); // current parent id (null = root)
  const [viewAll, setViewAll] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);

  function openPopover() {
    setDraft([...value]);
    setSearch('');
    setLevel(null);
    setViewAll(false);
    setOpen(true);
  }

  function toggle(id: string) {
    if (multiple) {
      setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    } else {
      setDraft((prev) => (prev.includes(id) ? [] : [id]));
    }
  }

  function commit() {
    onChange(draft);
    setOpen(false);
  }

  const needle = search.trim().toLowerCase();
  const visibleSites: SiteLite[] = useMemo(() => {
    if (needle.length > 0) {
      return sites.filter((s) => s.name.toLowerCase().includes(needle));
    }
    if (viewAll) return sites;
    return childrenOf.get(level) ?? [];
  }, [needle, viewAll, level, sites, childrenOf]);

  const flat = needle.length > 0 || viewAll;
  const currentSite = level !== null ? byId.get(level) : undefined;

  const selectedSites = value.map((id) => byId.get(id)).filter((s): s is SiteLite => s !== undefined);
  const triggerText =
    selectedSites.length === 0
      ? placeholder
      : multiple
        ? `${selectedSites.length} selected`
        : (selectedSites[0]?.name ?? placeholder);

  return (
    <div className={cn('space-y-2', className)}>
      {label !== undefined ? <span className="text-sm font-medium">{label}</span> : null}

      <Popover open={open} onOpenChange={(o) => (o ? openPopover() : setOpen(false))}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40 disabled:opacity-50"
          >
            <span className={cn('truncate', selectedSites.length === 0 && 'text-muted-foreground')}>
              {triggerText}
            </span>
            <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-80 p-0" align="start">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          {/* Breadcrumb / back row when drilled into a parent */}
          {!flat && currentSite !== undefined ? (
            <button
              type="button"
              onClick={() => setLevel(currentSite.parentId)}
              className="flex w-full items-center gap-1.5 border-b px-3 py-2 text-sm font-medium hover:bg-accent/40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
              {currentSite.name}
            </button>
          ) : null}

          <div className="max-h-64 overflow-y-auto py-1">
            {visibleSites.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No sites found</p>
            ) : (
              visibleSites.map((site) => {
                const checked = draft.includes(site.id);
                const hasKids = (childrenOf.get(site.id) ?? []).length > 0;
                return (
                  <div key={site.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => toggle(site.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/40"
                      style={flat ? { paddingLeft: `${0.75 + site.depth * 0.75}rem` } : undefined}
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{site.name}</span>
                      {checked ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      ) : null}
                    </button>
                    {!flat && hasKids ? (
                      <button
                        type="button"
                        onClick={() => {
                          setLevel(site.id);
                          setSearch('');
                        }}
                        aria-label={`Open ${site.name}`}
                        className="px-2 py-2 text-muted-foreground hover:text-foreground"
                      >
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {!flat && sites.length > 0 ? (
            <button
              type="button"
              onClick={() => setViewAll(true)}
              className="block border-t px-3 py-2 text-sm font-medium text-primary hover:underline"
            >
              View all
            </button>
          ) : null}

          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            <button
              type="button"
              onClick={() => setDraft([])}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              Clear selections
            </button>
            <button
              type="button"
              onClick={commit}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Done
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Selected chips (multi-select only) */}
      {multiple && selectedSites.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedSites.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"
            >
              {s.name}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== s.id))}
                aria-label={`Remove ${s.name}`}
                className="rounded-full text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
