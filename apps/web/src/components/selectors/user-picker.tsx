'use client';

/**
 * Single-person picker — the platform-wide answer to "choose one user".
 *
 * A native <select> over `users.list` caps out at the first page and is
 * unusable at a thousand users, so this is a searchable popover with
 * SERVER-side search (the TR-A2 lesson: pass `search` through, don't
 * filter the first 50 client-side). Optionally:
 *   - `allowFreeText`: a person without an account (visitor, contractor)
 *     can be named as typed — the option row offers the raw query;
 *   - an invite affordance (shown only to holders of `users.invite`):
 *     sends the invitation and says the person will appear once they
 *     accept — an invite mints no user row, so there is nothing to
 *     select yet.
 *
 * Value is `{ userId, name }` so name-backed columns (PEEP person, FRA
 * assessor) and id-backed columns (marshals) share one component:
 * free-text picks carry `userId: null`.
 */
import { Check, Search, UserPlus, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { trpc } from '../../lib/trpc/client';
import { cn } from '../../lib/cn';
import { displayUserName } from '../../lib/user-name';
import { useHasPermission } from '../../lib/permissions-context';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { InviteUserDialog } from './invite-user-dialog';

export interface UserPickerValue {
  /** Null for a free-text person with no account. */
  userId: string | null;
  name: string;
}

export interface UserPickerProps {
  value: UserPickerValue | null;
  onChange: (next: UserPickerValue | null) => void;
  /** Allow naming a person who has no account (value.userId = null). */
  allowFreeText?: boolean;
  /** Offer the invite affordance (still hidden without `users.invite`). */
  allowInvite?: boolean;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
  /** Restrict the selectable users (e.g. separation-of-duties). */
  filterUser?: (user: { id: string; name: string; email: string }) => boolean;
}

export function UserPicker({
  value,
  onChange,
  allowFreeText = false,
  allowInvite = true,
  label,
  placeholder,
  disabled = false,
  className,
  clearable = true,
  filterUser,
}: UserPickerProps) {
  const t = useTranslations('userPicker');
  const canInvite = useHasPermission('users.invite');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(handle);
  }, [search]);

  const usersQuery = trpc.users.list.useQuery(
    debounced === '' ? { limit: 50 } : { limit: 50, search: debounced },
    { enabled: open },
  );

  const users = (usersQuery.data?.users ?? [])
    .map((u) => ({ id: u.id, name: displayUserName(u), email: u.email }))
    .filter((u) => (filterUser ? filterUser(u) : true));

  function pick(next: UserPickerValue | null) {
    onChange(next);
    setOpen(false);
    setSearch('');
  }

  const freeTextCandidate = allowFreeText && search.trim().length > 0 ? search.trim() : null;

  return (
    <div className={cn('space-y-2', className)}>
      {label !== undefined ? <span className="text-sm font-medium">{label}</span> : null}

      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex w-full items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40 disabled:opacity-50"
          >
            <span className={cn('truncate', value === null && 'text-muted-foreground')}>
              {value === null ? (placeholder ?? t('placeholder')) : value.name}
            </span>
            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
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
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {freeTextCandidate !== null ? (
              <button
                type="button"
                onClick={() => pick({ userId: null, name: freeTextCandidate })}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/40"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {t('useFreeText', { name: freeTextCandidate })}
                </span>
              </button>
            ) : null}
            {users.length === 0 && freeTextCandidate === null ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                {usersQuery.isFetching ? t('searching') : t('nothingFound')}
              </p>
            ) : (
              users.map((u) => {
                const checked = value?.userId === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => pick({ userId: u.id, name: u.name })}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/40"
                  >
                    <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{u.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {u.email}
                      </span>
                    </span>
                    {checked ? (
                      <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    ) : null}
                  </button>
                );
              })
            )}
            {usersQuery.data?.hasMore === true ? (
              <p className="px-3 py-1.5 text-xs text-muted-foreground">{t('refineHint')}</p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
            {allowInvite && canInvite ? (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                <UserPlus className="h-3.5 w-3.5" aria-hidden />
                {t('inviteButton')}
              </button>
            ) : (
              <span />
            )}
            {clearable && value !== null ? (
              <button
                type="button"
                onClick={() => pick(null)}
                className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
              >
                {t('clear')}
              </button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
