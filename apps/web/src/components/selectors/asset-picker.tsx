'use client';

/**
 * Multi-select asset picker — searchable, and it shows the hierarchy.
 *
 * It replaces a native `<select>` that listed every asset in the tenant as a
 * flat run of options. That is fine for the three assets a demo has and
 * unusable for the register a real plant department keeps: no way to search,
 * no way to tell "CNC Mill 03" from its own spindle motor, and a scroll of
 * several hundred indistinguishable lines.
 *
 * Two modes, because browsing and searching want different shapes:
 *
 *   - **Browsing** (empty search box) shows only top-level assets, each with
 *     an expander that loads its sub-assets on demand. Nothing loads the
 *     whole register, so the depth is navigable rather than dumped.
 *   - **Searching** goes flat and server-side across BOTH levels, and each
 *     hit that is a sub-assets names its parent underneath. A match has to
 *     say where it lives — "Spindle motor" is three different objects in a
 *     workshop with three mills.
 *
 * Search is server-side deliberately: `assets.list` is keyset-paged, so
 * filtering the page the client happens to hold would search 50 rows out of
 * however many the tenant owns and report the rest as absent.
 *
 * Parent and child are each selectable in their own right — attaching an
 * action to the mill and attaching it to that mill's spindle motor are
 * different claims, and the picker must not collapse them.
 */

import { Check, ChevronRight, Package, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';
import { trpc } from '../../lib/trpc/client';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/** The subset of an `assets.list` row this picker renders. */
interface AssetRow {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  typeName: string | null;
  childrenCount: number;
}

const PAGE_SIZE = 50;
/** Sub-assets of one parent. One level deep (AS-E11), so this is the lot. */
const CHILD_PAGE_SIZE = 100;

export interface AssetPickerProps {
  /** Ids already attached; rendered with a tick and toggled off on click. */
  selectedIds: readonly string[];
  /** Called with the id that was clicked and whether it is now selected. */
  onToggle: (assetId: string, selected: boolean) => void;
  /** Trigger label when nothing is attached yet. */
  placeholder: string;
  disabled?: boolean;
  className?: string;
}

export function AssetPicker({
  selectedIds,
  onToggle,
  placeholder,
  disabled = false,
  className,
}: AssetPickerProps) {
  const t = useTranslations('assetPicker');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);

  const searching = debounced !== '';

  const listQuery = trpc.assets.list.useQuery(
    searching
      ? { search: debounced, limit: PAGE_SIZE }
      : // Top level only. Sub-assets arrive when their parent is expanded.
        { parentId: null, limit: PAGE_SIZE },
    { enabled: open },
  );

  // NR3-02: a row that does not match what is CURRENTLY typed must never be
  // clickable. The 250ms debounce plus the fetch means the visible rows lag
  // the keystrokes, and a stale row sits exactly where the next click lands —
  // which would attach the wrong asset to the action and consume the click.
  // The guard applies only while rows can lag; a settled result is trusted as
  // it stands, because the server also matches on the QR token, which is not
  // displayed and would be filtered away here.
  const needle = search.trim().toLowerCase();
  const resultsPending = listQuery.isFetching || needle !== debounced.toLowerCase();
  const rows: AssetRow[] = (listQuery.data?.assets ?? []).filter(
    (a) => !resultsPending || needle.length === 0 || a.name.toLowerCase().includes(needle),
  );

  const selected = new Set(selectedIds);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSearch('');
          setDebounced('');
          setExpanded(new Set());
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2 py-1 text-left text-sm transition-colors hover:bg-accent/40 disabled:opacity-50',
            className,
          )}
        >
          <span className="truncate text-muted-foreground">{placeholder}</span>
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-80 p-0"
        align="start"
        // NR3-02: Radix pulls focus back to the trigger on close, stealing it
        // from whatever the user clicked next. Let the click's target keep it.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {resultsPending || listQuery.isPending ? t('searching') : t('nothingFound')}
            </p>
          ) : (
            rows.map((asset) => (
              <div key={asset.id}>
                <AssetRowButton
                  asset={asset}
                  checked={selected.has(asset.id)}
                  expanded={expanded.has(asset.id)}
                  // Expanding is for browsing. A search is already flat across
                  // both levels, so an expander there would re-list rows the
                  // result set is showing anyway.
                  expandable={!searching && asset.childrenCount > 0}
                  onToggleExpand={() => toggleExpand(asset.id)}
                  onSelect={() => onToggle(asset.id, !selected.has(asset.id))}
                />
                {!searching && expanded.has(asset.id) ? (
                  <AssetChildRows parentId={asset.id} selected={selected} onToggle={onToggle} />
                ) : null}
              </div>
            ))
          )}

          {listQuery.data?.hasMore === true ? (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">{t('refineHint')}</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Sub-assets of one parent, fetched when that parent is expanded.
 *
 * Its own component so it can hold its own query: a hook cannot be called per
 * row of a list, and eagerly loading every parent's children is the payload
 * this picker exists to avoid.
 */
function AssetChildRows({
  parentId,
  selected,
  onToggle,
}: {
  parentId: string;
  selected: ReadonlySet<string>;
  onToggle: (assetId: string, selected: boolean) => void;
}) {
  const t = useTranslations('assetPicker');
  const childQuery = trpc.assets.list.useQuery({ parentId, limit: CHILD_PAGE_SIZE });
  const children = childQuery.data?.assets ?? [];

  if (childQuery.isPending) {
    return <p className="py-1 pl-11 pr-3 text-xs text-muted-foreground">{t('searching')}</p>;
  }

  return (
    <div className="ml-[1.375rem] border-l pl-1">
      {children.map((child) => (
        <AssetRowButton
          key={child.id}
          asset={child}
          checked={selected.has(child.id)}
          expanded={false}
          expandable={false}
          onToggleExpand={() => undefined}
          onSelect={() => onToggle(child.id, !selected.has(child.id))}
          nested
        />
      ))}
    </div>
  );
}

function AssetRowButton({
  asset,
  checked,
  expanded,
  expandable,
  onToggleExpand,
  onSelect,
  nested = false,
}: {
  asset: AssetRow;
  checked: boolean;
  expanded: boolean;
  expandable: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  nested?: boolean;
}) {
  const t = useTranslations('assetPicker');
  // When searching, a sub-asset must say which machine it belongs to; the
  // type is the useful second line otherwise.
  const sub = asset.parentName !== null && !nested ? asset.parentName : asset.typeName;

  return (
    <div className="flex items-stretch">
      {/* The expander is its own control, so clicking a parent's NAME selects
          the parent rather than merely opening it — the mill is a legitimate
          target in its own right. */}
      {expandable ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? t('collapse') : t('expand')}
          aria-expanded={expanded}
          className="flex w-6 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <ChevronRight
            className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
            aria-hidden
          />
        </button>
      ) : (
        <span className="w-6 shrink-0" />
      )}

      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-3 text-left text-sm hover:bg-accent/40"
      >
        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{asset.name}</span>
          {sub !== null && sub !== '' ? (
            <span className="block truncate text-xs text-muted-foreground">
              {asset.parentName !== null && !nested ? t('inParent', { parent: sub }) : sub}
            </span>
          ) : null}
        </span>
        {asset.childrenCount > 0 && !nested ? (
          <span className="shrink-0 text-xs text-muted-foreground">{asset.childrenCount}</span>
        ) : null}
        {checked ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
      </button>
    </div>
  );
}
