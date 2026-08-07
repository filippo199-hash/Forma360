'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * A square icon button with a hover tooltip — the platform standard for
 * utility header actions (Export CSV, Show archived, Categories, Settings).
 * ADR 0014: the header row carries destinations and one primary action;
 * secondary "tools" collapse to icons so they stop crowding the row, and the
 * tooltip carries the label the button no longer shows.
 *
 * `label` is the already-translated string — it is both the tooltip text and
 * the `aria-label`, so the control stays accessible without visible text.
 * Pass `href` for navigation (renders a `Link`) or `onClick` for an action.
 * `active` marks a toggle that is on (e.g. Show archived) — it flips the
 * button to the filled `secondary` look and sets `aria-pressed`.
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
  variant = 'outline',
  type = 'button',
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  active?: boolean;
  variant?: 'outline' | 'ghost' | 'secondary' | 'destructive';
  type?: 'button' | 'submit';
}) {
  const resolvedVariant = active === true ? 'secondary' : variant;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href !== undefined ? (
          <Button
            variant={resolvedVariant}
            size="icon"
            asChild
            aria-label={label}
            {...(active !== undefined ? { 'aria-pressed': active } : {})}
          >
            <Link href={href}>
              <Icon className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button
            type={type}
            variant={resolvedVariant}
            size="icon"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            {...(active !== undefined ? { 'aria-pressed': active } : {})}
          >
            <Icon className="h-4 w-4" />
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
