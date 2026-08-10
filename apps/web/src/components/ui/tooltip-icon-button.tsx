'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import { cn } from '../../lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * G1 — the single canonical style for a utility icon action (Export CSV,
 * Show archived, Categories, Settings, per-row Edit/Delete): a borderless,
 * transparent square with the icon in the accent/brand blue (`text-primary`,
 * so tenant themes apply), a hover state that tints the background, and a
 * tooltip carrying the label the button no longer shows. ADR 0014: the
 * header row keeps one primary button; the tools collapse to these icons.
 *
 * `label` is the already-translated string — both the tooltip and the
 * `aria-label`, so the control stays accessible without visible text.
 * Pass `href` for navigation (renders a `Link`) or `onClick` for an action.
 * `active` marks a toggle that is on (e.g. Show archived) — it keeps the
 * hover tint applied and sets `aria-pressed`. `variant="destructive"`
 * switches the accent to the destructive red (a delete action).
 *
 * Requires a `TooltipProvider` ancestor (mounted once in the locale layout).
 */
export function TooltipIconButton({
  icon: Icon,
  label,
  onClick,
  href,
  disabled,
  active,
  variant = 'default',
  type = 'button',
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  active?: boolean;
  /** `default` = accent blue; `destructive` = red. Legacy values map to default. */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'destructive';
  type?: 'button' | 'submit';
}) {
  const destructive = variant === 'destructive';
  const cls = cn(
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
    destructive
      ? 'text-destructive hover:bg-destructive/10 focus-visible:ring-destructive/40'
      : 'text-primary hover:bg-primary/10 focus-visible:ring-primary/40',
    active === true && (destructive ? 'bg-destructive/10' : 'bg-primary/10'),
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href !== undefined ? (
          <Link
            href={href}
            aria-label={label}
            className={cls}
            {...(active !== undefined ? { 'aria-pressed': active } : {})}
          >
            <Icon className="h-4 w-4" />
          </Link>
        ) : (
          <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            className={cls}
            {...(active !== undefined ? { 'aria-pressed': active } : {})}
          >
            <Icon className="h-4 w-4" />
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
