'use client';

/**
 * G1 — the single canonical style for an icon that sits next to a primary
 * button in the top-right of a module page (and per-row/detail icon actions
 * that follow the same rule):
 *
 *   - transparent background, no border
 *   - icon in the accent/brand blue (`text-primary`, so tenant themes apply)
 *   - a hover state that tints the background
 *   - a tooltip on hover (G6 — every converted icon gets one)
 *
 * Use `IconActionButton` for click handlers and `IconActionLink` for
 * navigation; both share one class so the two read identically.
 */
import Link from 'next/link';
import type { ComponentType, MouseEventHandler, ReactNode, SVGProps } from 'react';
import { cn } from '../lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

export const ICON_ACTION_CLASS =
  'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

function withTooltip(label: string, node: ReactNode): ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function IconActionButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  type = 'button',
  className,
}: {
  icon: IconType;
  /** Tooltip text + accessible name. */
  label: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  return withTooltip(
    label,
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(ICON_ACTION_CLASS, className)}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>,
  );
}

export function IconActionLink({
  icon: Icon,
  label,
  href,
  target,
  className,
}: {
  icon: IconType;
  label: string;
  href: string;
  target?: string;
  className?: string;
}) {
  return withTooltip(
    label,
    <Link
      href={href}
      aria-label={label}
      className={cn(ICON_ACTION_CLASS, className)}
      {...(target !== undefined ? { target } : {})}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </Link>,
  );
}
