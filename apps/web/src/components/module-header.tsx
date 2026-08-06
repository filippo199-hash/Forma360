import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * The standard module list-page header (ADR 0014 — Inspections is the
 * reference). One `<header>` row: title + optional muted subtitle on the
 * left, action buttons on the right at the same level.
 *
 * Defined once so modules stop drifting — before this, headers disagreed on
 * title size (`text-xl` vs `text-2xl`), whether the subtitle showed on mobile,
 * and whether the wrapper was a `<header>` or a bare `<div>`.
 *
 * `title` and `description` are already-translated strings (the caller owns
 * i18n); `children` are the right-hand actions.
 */
export function ModuleHeader({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-wrap items-center justify-between gap-4', className)}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && description !== '' ? (
          <p className="mt-1 hidden text-sm text-muted-foreground sm:block">{description}</p>
        ) : null}
      </div>
      {children !== undefined ? <div className="flex items-center gap-2">{children}</div> : null}
    </header>
  );
}
