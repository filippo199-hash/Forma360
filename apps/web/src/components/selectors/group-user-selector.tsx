'use client';

import { Check, Search, Users, UserRound, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { displayUserName } from '../../lib/user-name';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

type Mode = 'groups' | 'users' | 'both';

export interface GroupUserSelectorProps {
  /** Selected ids (group ids and/or user ids, depending on mode). */
  value: readonly string[];
  onChange: (next: string[]) => void;
  /** Which entities can be selected. 'both' shows Groups/Users tabs. */
  mode?: Mode;
  /** Multi-select (default) vs single-select. */
  multiple?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /**
   * Optional predicate to restrict which users are selectable/visible
   * (e.g. separation-of-duties exclusions on a permit). A user filtered
   * out here is removed from the list entirely.
   */
  filterUser?: (user: { id: string; name: string; sub: string | null }) => boolean;
}

interface Entity {
  id: string;
  name: string;
  sub: string | null;
}

/**
 * Platform-wide group / user selector. Searchable, multi-select, with
 * Groups / Users tabs when both kinds are selectable. Selections show as
 * removable chips (multi) or the chosen name (single).
 */
export function GroupUserSelector({
  value,
  onChange,
  mode = 'both',
  multiple = true,
  label,
  placeholder,
  disabled = false,
  className,
  filterUser,
}: GroupUserSelectorProps) {
  const t = useTranslations('groupUserSelector');
  const placeholderText = placeholder ?? t('placeholder');
  const wantGroups = mode !== 'users';
  const wantUsers = mode !== 'groups';

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'groups' | 'users'>(wantGroups ? 'groups' : 'users');
  const [draft, setDraft] = useState<string[]>([]);
  // Server-side user search (TR-A2): the first page of 200 is not "all
  // users" in a large org, so the typed term goes to the server too.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);
  const searchingUsers = (mode === 'users' || tab === 'users') && debouncedSearch !== '';

  const groupsQuery = trpc.groups.list.useQuery(undefined, { enabled: wantGroups });
  const usersQuery = trpc.users.list.useQuery(
    searchingUsers ? { limit: 200, search: debouncedSearch } : { limit: 200 },
    { enabled: wantUsers },
  );
  // Selected ids can fall outside the current search page — keep an
  // unsearched base page so chips and single-select labels stay resolvable.
  const baseUsersQuery = trpc.users.list.useQuery({ limit: 200 }, { enabled: wantUsers });

  const groups = useMemo<Entity[]>(
    () => (groupsQuery.data ?? []).map((g) => ({ id: g.id, name: g.name, sub: null })),
    [groupsQuery.data],
  );
  const users = useMemo<Entity[]>(() => {
    const mapped = (usersQuery.data?.users ?? []).map((u) => ({
      id: u.id,
      name: displayUserName(u),
      sub: u.email as string | null,
    }));
    return filterUser ? mapped.filter(filterUser) : mapped;
  }, [usersQuery.data, filterUser]);

  const baseUsers = useMemo<Entity[]>(
    () =>
      (baseUsersQuery.data?.users ?? []).map((u) => ({
        id: u.id,
        name: displayUserName(u),
        sub: u.email as string | null,
      })),
    [baseUsersQuery.data],
  );

  const byId = useMemo(() => {
    const m = new Map<string, Entity>();
    for (const e of [...groups, ...baseUsers, ...users]) m.set(e.id, e);
    return m;
  }, [groups, baseUsers, users]);

  function openPopover() {
    setDraft([...value]);
    setSearch('');
    setTab(wantGroups ? 'groups' : 'users');
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

  const showTabs = mode === 'both';
  const activeList =
    mode === 'groups' ? groups : mode === 'users' ? users : tab === 'groups' ? groups : users;
  const needle = search.trim().toLowerCase();
  const isUserList = activeList === users;
  // Users are already server-filtered when a term is set; groups (and the
  // debounce gap) still filter client-side.
  const filtered =
    needle.length > 0 && !(isUserList && debouncedSearch.toLowerCase() === needle)
      ? activeList.filter(
          (e) =>
            e.name.toLowerCase().includes(needle) || (e.sub ?? '').toLowerCase().includes(needle),
        )
      : activeList;

  const selected = value.map((id) => byId.get(id)).filter((e): e is Entity => e !== undefined);
  const triggerText =
    selected.length === 0
      ? placeholderText
      : multiple
        ? t('selected', { count: selected.length })
        : (selected[0]?.name ?? placeholderText);

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
            <span className={cn('truncate', selected.length === 0 && 'text-muted-foreground')}>
              {triggerText}
            </span>
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>

        <PopoverContent
          className="w-80 p-0"
          align="start"
          // NR3-02: don't yank focus back to the trigger on close — the
          // field the user clicked next must keep the focus it received.
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {showTabs ? (
            <div className="flex border-b">
              {(['groups', 'users'] as const).map((tk) => (
                <button
                  key={tk}
                  type="button"
                  onClick={() => {
                    setTab(tk);
                    setSearch('');
                  }}
                  className={cn(
                    'flex-1 -mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                    tab === tk
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(tk === 'groups' ? 'tabGroups' : 'tabUsers')}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                showTabs ? (tab === 'groups' ? t('searchGroups') : t('searchUsers')) : t('search')
              }
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {t('nothingFound')}
              </p>
            ) : (
              filtered.map((e) => {
                const checked = draft.includes(e.id);
                const isUser = users.some((u) => u.id === e.id);
                const Icon = isUser ? UserRound : Users;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => toggle(e.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/40"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{e.name}</span>
                      {e.sub !== null ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {e.sub}
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
            <button
              type="button"
              onClick={() => setDraft([])}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              {t('clear')}
            </button>
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

      {multiple && selected.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selected.map((e) => (
            <span
              key={e.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"
            >
              {e.name}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== e.id))}
                aria-label={t('removeAria', { name: e.name })}
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
