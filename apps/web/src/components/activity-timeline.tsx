'use client';

/**
 * The one way an activity/history stream renders (review round 4).
 *
 * Entries group under day headings (Today / Yesterday / "Sat 16 Aug"),
 * each row hanging off a vertical rail with a dot: time · actor · what
 * happened, with an optional detail block underneath. Before this,
 * eleven surfaces each rendered their own flat `time · label · detail`
 * list — five modules were asked to adopt one legible shape instead.
 *
 * The component is presentation-only. Callers adapt their rows into
 * `ActivityTimelineEntry` — the label is already-translated copy (kind
 * keys differ per module and stay in the module), the actor is a
 * resolved display name, and `detail` is a ReactNode so a module can
 * keep its bespoke rendering (permit ISO-date rewriting, incident
 * from → to diffs via <TimelineDiff>).
 *
 * Entries must arrive newest-first — every router already returns that
 * order, and the grouping is a single pass that relies on it.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { formatDayLabel, formatTime, localDayKey } from '../lib/format-date';

export interface ActivityTimelineEntry {
  id: string;
  at: Date | string;
  /** Already-translated event copy. May carry links (asset activity). */
  label: ReactNode;
  /** Resolved display name; null/undefined/'' renders no actor. */
  actor?: string | null;
  /** Optional detail block under the sentence. */
  detail?: ReactNode;
}

export interface TimelineDayGroup<T extends { at: Date | string }> {
  key: string;
  at: Date | string;
  rows: T[];
}

/**
 * Single pass over a newest-first list, bucketing by LOCAL calendar day.
 * Exported for its unit test — the UTC day-key trap (an entry at 23:40
 * in a UTC-negative zone bucketing into "tomorrow") lives here.
 */
export function groupTimelineEntries<T extends { at: Date | string }>(
  entries: readonly T[],
): Array<TimelineDayGroup<T>> {
  const groups: Array<TimelineDayGroup<T>> = [];
  for (const entry of entries) {
    const key = localDayKey(entry.at) ?? 'unknown';
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.rows.push(entry);
    else groups.push({ key, at: entry.at, rows: [entry] });
  }
  return groups;
}

export function ActivityTimeline({
  entries,
  locale,
  emptyLabel,
  className,
}: {
  /** Newest first. */
  entries: readonly ActivityTimelineEntry[];
  locale: string;
  /** Rendered when there is nothing to show; omit to render nothing. */
  emptyLabel?: string;
  className?: string;
}) {
  const t = useTranslations('activityTimeline');

  if (entries.length === 0) {
    return emptyLabel !== undefined ? (
      <p className="text-sm text-muted-foreground">{emptyLabel}</p>
    ) : null;
  }

  const groups = groupTimelineEntries(entries);
  const todayKey = localDayKey(new Date());
  const yesterdayKey = localDayKey(new Date(Date.now() - 86_400_000));

  return (
    <div className={cn('space-y-4', className)}>
      {groups.map((group) => (
        <section key={group.key}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.key === todayKey
              ? t('today')
              : group.key === yesterdayKey
                ? t('yesterday')
                : formatDayLabel(group.at, locale)}
          </h3>
          <ol className="ml-1 space-y-3 border-l pl-5">
            {group.rows.map((row) => (
              <li key={row.id} className="relative text-sm">
                <span
                  aria-hidden
                  className="absolute -left-[25.5px] top-1 h-2.5 w-2.5 rounded-full border-2 border-primary bg-background"
                />
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatTime(row.at, locale)}
                  </span>
                  {row.actor != null && row.actor !== '' ? (
                    <span className="font-medium">{row.actor}</span>
                  ) : null}
                  <span className="min-w-0">{row.label}</span>
                </div>
                {row.detail != null && row.detail !== '' ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">{row.detail}</div>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/**
 * `old → new` with the reference image's diff colouring: the removed
 * value struck through on red, the new value on green. Both halves are
 * already-translated display strings.
 */
export function TimelineDiff({ from, to }: { from: string; to: string }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1">
      <del className="rounded bg-red-100 px-1 text-red-900 dark:bg-red-950/60 dark:text-red-200">
        {from}
      </del>
      <span aria-hidden>→</span>
      <ins className="rounded bg-emerald-100 px-1 no-underline text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200">
        {to}
      </ins>
    </span>
  );
}
