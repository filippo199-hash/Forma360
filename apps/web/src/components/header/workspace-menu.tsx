'use client';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

/**
 * Top-left workspace switcher: the signed-in email as the trigger, the
 * workspaces the account belongs to in the dropdown.
 *
 * Today an account belongs to exactly ONE workspace (one tenant per user,
 * ADR 0002/0004), so the list has a single, already-selected row — the
 * control exists so the chrome reads like the multi-workspace product this
 * will become, and gains rows without moving when membership does.
 */
export function WorkspaceMenu({ email, workspaceName }: { email: string; workspaceName: string }) {
  const t = useTranslations('common');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden min-w-0 items-center gap-1 text-sm font-normal text-muted-foreground hover:text-foreground sm:flex"
        >
          <span className="max-w-[18ch] truncate">{email}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('workspacesLabel')}
        </DropdownMenuLabel>
        <DropdownMenuItem className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{workspaceName}</span>
          <Check className="h-4 w-4 shrink-0" aria-hidden />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
