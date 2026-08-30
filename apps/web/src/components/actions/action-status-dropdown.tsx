'use client';

/**
 * The action status control (review round 4): the CURRENT status as a
 * coloured pill that opens a menu of the states it can move to. It
 * replaces a row of every-status-at-once buttons — five pills in a
 * scrollable strip read as filter chips, and four of them described
 * states the action was NOT in.
 *
 * The option list mirrors the server rule in `actions.setStatus`
 * (UXW2-08): managers may pick any status; an assignee moves between
 * open / in progress / completed only. Presentation, not authority —
 * the server re-checks, including the per-type group gates on terminal
 * statuses. Both the sheet panel and the full action page render this
 * one component, which is also what ended their drift (the page used to
 * offer non-managers 'blocked', which the server refuses).
 */
import { Check, ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export type ActionStatus = 'open' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export const ACTION_STATUSES: ReadonlyArray<ActionStatus> = [
  'open',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
];

export const ACTION_STATUS_COLORS: Record<ActionStatus, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-100',
  in_progress: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
  blocked: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-100',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  cancelled: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

/** A small filled dot in the status colour. */
export const ACTION_STATUS_DOT: Record<ActionStatus, string> = {
  open: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  blocked: 'bg-red-500',
  completed: 'bg-emerald-500',
  cancelled: 'bg-slate-400',
};

/** The server's assignee whitelist (actions.setStatus, UXW2-08). */
const ASSIGNEE_STATUSES: ReadonlyArray<ActionStatus> = ['open', 'in_progress', 'completed'];

export function ActionStatusDropdown({
  status,
  canManage,
  disabled = false,
  isPending = false,
  onSetStatus,
}: {
  status: ActionStatus;
  canManage: boolean;
  disabled?: boolean;
  isPending?: boolean;
  onSetStatus: (next: ActionStatus) => void;
}) {
  const tStatus = useTranslations('actions.status');
  const options = canManage ? ACTION_STATUSES : ASSIGNEE_STATUSES;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || isPending}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-opacity',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-60',
            ACTION_STATUS_COLORS[status],
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', ACTION_STATUS_DOT[status])} aria-hidden />
          {tStatus(status)}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options.map((s) => (
          <DropdownMenuItem
            key={s}
            onSelect={() => {
              if (s !== status) onSetStatus(s);
            }}
          >
            <span
              className={cn('mr-2 h-2 w-2 rounded-full', ACTION_STATUS_DOT[s])}
              aria-hidden
            />
            {tStatus(s)}
            {s === status ? <Check className="ml-auto h-3.5 w-3.5" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
