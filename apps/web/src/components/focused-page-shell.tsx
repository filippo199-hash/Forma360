'use client';

/**
 * Full-screen focused shell used for creation and edit flows.
 *
 * Uses `fixed inset-0 z-40` to overlay the global sidebar without
 * changing layout flow — same technique as the template EditorShell
 * (which sits at z-50). The background defaults to `bg-muted` so the
 * top-bar card stands out clearly against the page body.
 *
 * Usage:
 *   <FocusedPageShell title={t('create.title')} backHref={`/${locale}/things`}>
 *     … form content …
 *   </FocusedPageShell>
 */

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from './ui/button';

interface FocusedPageShellProps {
  /** Page title shown next to the Cancel button. */
  title: string;
  /** Where the Cancel button navigates to. */
  backHref: string;
  /** Optional right-aligned action buttons (e.g. Save, Publish). */
  actions?: ReactNode;
  children: ReactNode;
  /**
   * Content container max-width.
   * - `'form'`  → max-w-2xl  (672 px) — single-column forms
   * - `'wide'`  → max-w-4xl  (896 px) — two-column or management pages
   * - `'full'`  → max-w-[1200px]       — tables / category grids
   * - `'split'` → no container         — caller provides its own full-width
   *                                      split layout (e.g. editor + live
   *                                      preview); content area becomes a
   *                                      flex row that fills the viewport.
   */
  width?: 'form' | 'wide' | 'full' | 'split';
}

const widthClass: Record<Exclude<NonNullable<FocusedPageShellProps['width']>, 'split'>, string> = {
  form: 'max-w-2xl',
  wide: 'max-w-4xl',
  full: 'max-w-[1200px]',
};

export function FocusedPageShell({
  title,
  backHref,
  actions,
  children,
  width = 'form',
}: FocusedPageShellProps) {
  const t = useTranslations('common');

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-muted">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-3 border-b bg-background px-4 py-3">
        <Button variant="outline" size="sm" asChild>
          <Link href={backHref}>{t('cancel')}</Link>
        </Button>
        <span className="text-sm font-medium">{title}</span>
        {actions !== undefined ? (
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {/* ── Scrollable content ───────────────────────────────────────── */}
      {width === 'split' ? (
        // Full-width split layout: caller renders its own columns (e.g. form
        // + preview). The parent must NOT scroll — each column manages its
        // own overflow so the columns can scroll independently.
        <div className="flex flex-1 overflow-hidden">{children}</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className={`mx-auto px-4 py-8 ${widthClass[width]}`}>{children}</div>
        </div>
      )}
    </div>
  );
}
