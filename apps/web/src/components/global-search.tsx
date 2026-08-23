'use client';

/**
 * GlobalSearch — a Cloudflare-style command-palette search modal.
 *
 * Opens via:
 *  - The search button in the site header
 *  - ⌘K (macOS) or Ctrl+K (Windows/Linux)
 *
 * Results are grouped by category (Assets, Inspections, Observations,
 * Actions, Heads Up, Documents, Compliance) and are fully keyboard
 * navigable (↑ ↓ Enter Escape).
 */

import {
  AlertCircle,
  Bell,
  BookOpen,
  CheckSquare,
  ChevronRight,
  ClipboardList,
  FileText,
  Loader2,
  Search,
  Siren,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { trpc } from '../lib/trpc/client';
import { SEARCH_CATEGORIES, type SearchIconKey } from '../lib/search-categories';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchItem {
  id: string;
  title: string;
  subtitle: string | null;
}

interface ResultCategory {
  key: string;
  label: string;
  icon: JSX.Element;
  items: SearchItem[];
  basePath: string;
}

/** Icon per category, keyed by the icon name the category table declares. */
const SEARCH_ICONS: Record<SearchIconKey, JSX.Element> = {
  asset: <BookOpen className="h-4 w-4" />,
  inspection: <ClipboardList className="h-4 w-4" />,
  observation: <AlertCircle className="h-4 w-4" />,
  action: <CheckSquare className="h-4 w-4" />,
  headsUp: <Bell className="h-4 w-4" />,
  document: <FileText className="h-4 w-4" />,
  incident: <Siren className="h-4 w-4" />,
};

// ─── Quick-access links shown when no query is typed ─────────────────────────

const QUICK_LINKS = [
  { key: 'assets', icon: <BookOpen className="h-4 w-4" />, path: '/assets' },
  { key: 'inspections', icon: <ClipboardList className="h-4 w-4" />, path: '/inspections' },
  { key: 'observations', icon: <AlertCircle className="h-4 w-4" />, path: '/observations' },
  { key: 'actions', icon: <CheckSquare className="h-4 w-4" />, path: '/actions' },
  { key: 'headsUp', icon: <Bell className="h-4 w-4" />, path: '/briefings' },
  { key: 'documents', icon: <FileText className="h-4 w-4" />, path: '/documents' },
] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function GlobalSearch({ variant = 'header' }: { variant?: 'header' | 'sidebar' } = {}) {
  const t = useTranslations('search');
  const locale = useLocale();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // ── Keyboard shortcut to open, and Escape to close ────────────────────────
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      // Escape is handled here as well as on the dialog: the dialog's own
      // handler only fires while focus is inside it, and focus is not
      // guaranteed to be — a click on the backdrop moves it to <body>.
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * Portals mount to `document.body`, which does not exist during SSR. Track
   * mount so the first client render matches the server's (no overlay), and
   * the portal only appears afterwards.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ── Freeze the page behind the modal ──────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    // A modal whose background scrolls under it is half of what makes this
    // feel like it is not really a modal.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // ── Auto-focus when opened ─────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery('');
      setDebouncedQuery('');
      setActiveIndex(0);
      // Small delay to allow the overlay to mount before focusing
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  // ── Debounce query (300 ms) ────────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // Reset active index when results change
  useEffect(() => setActiveIndex(0), [debouncedQuery]);

  // ── tRPC search query ──────────────────────────────────────────────────────
  const shouldSearch = debouncedQuery.trim().length >= 2;

  const { data, isFetching } = trpc.search.global.useQuery(
    { query: debouncedQuery.trim() },
    { enabled: shouldSearch },
  );

  // ── Build category list from results ──────────────────────────────────────
  const categories: ResultCategory[] = [];

  if (data !== undefined) {
    // RS-A9: the category table lives in `src/lib/search-categories.ts` with a
    // test that walks the router's return shape — a server-side category that
    // is never listed here is a failing test, not a silent dropped result.
    for (const def of SEARCH_CATEGORIES) {
      const items = data[def.key as keyof typeof data];
      if (items.length > 0) {
        categories.push({
          key: def.key,
          label: t(def.labelKey as Parameters<typeof t>[0]),
          icon: SEARCH_ICONS[def.icon],
          items,
          basePath: def.basePath,
        });
      }
    }
  }

  // Flatten all items for keyboard navigation
  const allItems: Array<{ href: string; categoryKey: string }> = categories.flatMap((cat) =>
    cat.items.map((item) => ({
      href: `/${locale}/${cat.basePath}/${item.id}`,
      categoryKey: cat.key,
    })),
  );

  const totalItems = allItems.length;

  // ── Keyboard navigation inside the modal ──────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % Math.max(totalItems, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1));
      } else if (e.key === 'Enter' && totalItems > 0) {
        const item = allItems[activeIndex];
        if (item !== undefined) {
          router.push(item.href);
          setOpen(false);
        }
      }
    },
    [totalItems, activeIndex, allItems, router],
  );

  // ── Scroll active item into view ───────────────────────────────────────────
  useEffect(() => {
    const el = resultsRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  // ── Navigate on click ──────────────────────────────────────────────────────
  function navigate(href: string) {
    router.push(href);
    setOpen(false);
  }

  // ── Close on backdrop click ────────────────────────────────────────────────
  function onBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) setOpen(false);
  }

  // Global flat index counter (for keyboard navigation across categories)
  let globalIdx = 0;

  return (
    <>
      {/* ── Search trigger button ──────────────────────────────────────────
          The `sidebar` variant is the input-look trigger at the top of the
          nav rail (the Cloudflare-style "Quick search" placement); the
          default keeps the compact header styling for any other mount. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'sidebar'
            ? 'flex w-full items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
            : 'flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-80'
        }
        aria-label={t('openLabel')}
      >
        <Search className="h-3.5 w-3.5" />
        <span className={variant === 'sidebar' ? 'truncate' : 'hidden sm:inline'}>
          {t('placeholder')}
        </span>
        <kbd
          className={
            variant === 'sidebar'
              ? 'ml-auto rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground'
              : 'hidden rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground sm:ml-auto sm:inline'
          }
        >
          ⌘K
        </kbd>
      </button>

      {/* ── Modal overlay ─────────────────────────────────────────────────────
          Portalled to <body>, and that is load-bearing rather than tidiness.
          This component renders inside the site header, which carries
          `backdrop-blur` — and an element with a backdrop-filter becomes the
          containing block for every `position: fixed` descendant. So
          `fixed inset-0` sized itself against the HEADER instead of the
          viewport: the page behind stayed largely undimmed, and a click on
          any of that undimmed area never landed on the backdrop, so
          click-outside could not close anything. The header's `z-30` capped
          the overlay's stacking order for the same reason.
          Anything modal rendered from inside the header must portal out. */}
      {open && mounted
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-sm"
              onClick={onBackdropClick}
              role="presentation"
            >
              {/* ── Modal card ────────────────────────────────────────────────── */}
              <div
                className="w-full max-w-2xl overflow-hidden rounded-xl border bg-background shadow-2xl"
                role="dialog"
                aria-modal="true"
                aria-label={t('dialogLabel')}
                onKeyDown={handleKeyDown}
              >
                {/* ── Search input ───────────────────────────────────────────── */}
                <div className="flex items-center gap-3 border-b px-4 py-3">
                  {isFetching ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('inputPlaceholder')}
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {query.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        inputRef.current?.focus();
                      }}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                      aria-label={t('clearLabel')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="shrink-0 rounded border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:bg-muted"
                    aria-label={t('closeLabel')}
                  >
                    Esc
                  </button>
                </div>

                {/* ── Results / quick-access ─────────────────────────────────── */}
                <div ref={resultsRef} className="max-h-[60vh] overflow-y-auto py-2">
                  {/* ── No query typed: show quick-access links ──────────────── */}
                  {!shouldSearch ? (
                    <div className="px-2">
                      <p className="px-2 pb-1 pt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {t('quickAccess')}
                      </p>
                      {QUICK_LINKS.map((link) => (
                        <button
                          key={link.key}
                          type="button"
                          onClick={() => navigate(`/${locale}${link.path}`)}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-left transition-colors hover:bg-muted"
                        >
                          <span className="text-muted-foreground">{link.icon}</span>
                          <span>{t(`categories.${link.key}` as Parameters<typeof t>[0])}</span>
                          <ChevronRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                        </button>
                      ))}
                    </div>
                  ) : /* ── Query too short ───────────────────────────────────── */
                  debouncedQuery.trim().length < 2 && !isFetching ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      {t('typeMore')}
                    </div>
                  ) : /* ── Searching... (no data yet) ─────────────────────────── */
                  isFetching && data === undefined ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      {t('searching')}
                    </div>
                  ) : /* ── No results ─────────────────────────────────────────── */
                  categories.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium">{t('noResults')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t('noResultsHint', { query: debouncedQuery })}
                      </p>
                    </div>
                  ) : (
                    /* ── Grouped results ──────────────────────────────────────── */
                    <div className="px-2">
                      {categories.map((cat) => (
                        <div key={cat.key} className="mb-3 last:mb-0">
                          {/* Category header */}
                          <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                            <span className="text-muted-foreground">{cat.icon}</span>
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              {cat.label}
                            </span>
                          </div>

                          {/* Category items */}
                          {cat.items.map((item) => {
                            const href = `/${locale}/${cat.basePath}/${item.id}`;
                            const myIdx = globalIdx++;
                            const isActive = myIdx === activeIndex;

                            return (
                              <button
                                key={item.id}
                                type="button"
                                data-index={myIdx}
                                onClick={() => navigate(href)}
                                onMouseEnter={() => setActiveIndex(myIdx)}
                                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                                  isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium">{item.title}</p>
                                  {item.subtitle !== null ? (
                                    <p
                                      className={`truncate text-xs ${
                                        isActive
                                          ? 'text-primary-foreground/70'
                                          : 'text-muted-foreground'
                                      }`}
                                    >
                                      {item.subtitle}
                                    </p>
                                  ) : null}
                                </div>
                                <ChevronRight
                                  className={`h-3.5 w-3.5 shrink-0 ${
                                    isActive
                                      ? 'text-primary-foreground/70'
                                      : 'text-muted-foreground'
                                  }`}
                                />
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Footer: keyboard shortcut hints ───────────────────────── */}
                <div className="flex items-center gap-4 border-t px-4 py-2">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      ↑
                    </kbd>
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      ↓
                    </kbd>
                    <span className="ml-1">{t('hintNavigate')}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      ↵
                    </kbd>
                    <span className="ml-1">{t('hintOpen')}</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                      Esc
                    </kbd>
                    <span className="ml-1">{t('hintClose')}</span>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
