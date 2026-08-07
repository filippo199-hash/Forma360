'use client';

/**
 * Everything that has happened to an asset, in one list.
 *
 * Inspections, actions and observations used to be three separate tabs,
 * each showing one thin table. That is three clicks to answer "what is
 * going on with this machine", and none of the three answers it on its
 * own — the useful view is all of them, newest first.
 *
 * So they merge into a single Activity stream with type chips, and the
 * asset overview renders the top few through {@link AssetActivityList}
 * with `limit`, the way a summary card should.
 */
import { AlertTriangle, ClipboardCheck, ListChecks, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { cn } from '../../lib/cn';

export type ActivityKind = 'inspection' | 'action' | 'observation';

export interface ActivityRow {
  kind: ActivityKind;
  id: string;
  title: string;
  status: string;
  /** Newest-first ordering key. */
  at: Date | null;
  href: string;
}

const KIND_ICON: Record<ActivityKind, LucideIcon> = {
  inspection: ClipboardCheck,
  action: ListChecks,
  observation: AlertTriangle,
};

const KIND_CLASS: Record<ActivityKind, string> = {
  inspection: 'text-blue-600 dark:text-blue-400',
  action: 'text-emerald-600 dark:text-emerald-400',
  observation: 'text-amber-600 dark:text-amber-400',
};

/**
 * Fold the three linked lists into one stream, newest first.
 *
 * Pure and exported so the merge is testable — the ordering is the whole
 * point of the view, and it is the sort of thing that silently breaks
 * when one source has null dates.
 */
export function buildActivityRows(input: {
  locale: string;
  inspections: ReadonlyArray<{
    id: string;
    title: string;
    status: string;
    startedAt: Date | string | null;
    completedAt: Date | string | null;
  }>;
  actions: ReadonlyArray<{
    id: string;
    title: string;
    status: string;
    dueAt: Date | string | null;
    createdAt: Date | string | null;
  }>;
  observations: ReadonlyArray<{
    id: string;
    title: string;
    status: string;
    createdAt: Date | string | null;
  }>;
}): ActivityRow[] {
  const asDate = (v: Date | string | null): Date | null => {
    if (v === null) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const rows: ActivityRow[] = [
    ...input.inspections.map((i) => ({
      kind: 'inspection' as const,
      id: i.id,
      title: i.title,
      status: i.status,
      at: asDate(i.completedAt) ?? asDate(i.startedAt),
      href: `/${input.locale}/inspections/${i.id}`,
    })),
    ...input.actions.map((a) => ({
      kind: 'action' as const,
      id: a.id,
      title: a.title,
      status: a.status,
      at: asDate(a.createdAt),
      href: `/${input.locale}/actions?action=${a.id}`,
    })),
    ...input.observations.map((o) => ({
      kind: 'observation' as const,
      id: o.id,
      title: o.title,
      status: o.status,
      at: asDate(o.createdAt),
      href: `/${input.locale}/observations/${o.id}`,
    })),
  ];

  // Newest first; undated rows sink rather than jumping to the top, which
  // is what a missing timestamp would do under a naive numeric sort.
  return rows.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

export function AssetActivityList({
  rows,
  limit,
  emptyLabel,
  statusLabel,
}: {
  rows: ReadonlyArray<ActivityRow>;
  /** Show only the newest N — the overview card's summary mode. */
  limit?: number;
  emptyLabel: string;
  /**
   * Per-kind status translation. Kept as a prop rather than translated
   * here because each module owns its own status vocabulary — showing a
   * raw `awaiting_signatures` to a user would be a regression on what the
   * three separate tabs already did correctly.
   */
  statusLabel: (kind: ActivityKind, status: string) => string;
}) {
  const t = useTranslations('assets.detail.activity');
  const format = useFormatter();
  const shown = limit === undefined ? rows : rows.slice(0, limit);

  if (shown.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className="divide-y">
      {shown.map((row) => {
        const Icon = KIND_ICON[row.kind];
        return (
          <li key={`${row.kind}-${row.id}`}>
            <Link
              href={row.href}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <Icon className={cn('h-4 w-4 shrink-0', KIND_CLASS[row.kind])} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{row.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`kinds.${row.kind}`)} · {statusLabel(row.kind, row.status)}
                </span>
              </span>
              {row.at !== null ? (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {format.dateTime(row.at, { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
