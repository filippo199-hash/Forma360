'use client';

/**
 * Scheduled-report chip for the dashboards home card. Shows at a glance
 * whether the dashboard emails a PDF on a schedule (count, or "delivery
 * paused" when every schedule is paused) with the per-schedule sentences
 * in a tooltip, and opens the schedule dialog in place for people who
 * hold analytics.schedules.manage — including a dashed "set one up"
 * affordance when nothing is scheduled yet.
 *
 * The server (dashboards.list) only sends `schedules` to people who
 * manage the row — a plain viewer gets null and no chip at all — and it
 * sends recipient COUNTS, never addresses.
 */
import { CalendarClock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '../../lib/cn';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useScheduleSentence } from './schedule-dialog';

export interface ScheduleSummary {
  rrule: string;
  paused: boolean;
  recipientCount: number;
}

export function DashboardScheduleChip({
  schedules,
  canSchedule,
  archived,
  onOpen,
}: {
  /** null = the viewer does not manage this dashboard — render nothing. */
  schedules: ScheduleSummary[] | null;
  canSchedule: boolean;
  archived: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('dashboards');
  const sentence = useScheduleSentence();

  if (schedules === null) return null;
  // No schedules yet: only show the "set one up" affordance to someone who
  // can actually add one, and never on an archived dashboard (the server
  // refuses new schedules there).
  const showEmptyAffordance = canSchedule && !archived;
  if (schedules.length === 0 && !showEmptyAffordance) return null;

  const allPaused = schedules.length > 0 && schedules.every((s) => s.paused);
  const label =
    schedules.length === 0
      ? t('list.scheduleNone')
      : allPaused
        ? t('list.schedulePaused')
        : t('list.scheduleCount', { count: schedules.length });

  const chipClass = cn(
    'inline-flex items-center gap-1 rounded-full border px-2 py-0.5',
    schedules.length === 0 ? 'border-dashed text-muted-foreground/80' : 'text-muted-foreground',
    canSchedule && 'relative z-10 transition-colors hover:bg-muted hover:text-foreground',
  );
  const inner = (
    <>
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {label}
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {canSchedule ? (
          // Sits ABOVE the card's stretched link (z-10) as a true sibling
          // control, the same pattern as the favourite star.
          <button type="button" className={chipClass} aria-haspopup="dialog" onClick={onOpen}>
            {inner}
          </button>
        ) : (
          // Focusable so keyboard users get the tooltip too.
          <span tabIndex={0} className={chipClass}>
            {inner}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {schedules.length === 0 ? (
          t('scheduleDialog.title')
        ) : (
          <ul className="space-y-0.5">
            {schedules.map((s, i) => (
              <li key={i}>
                {sentence(s.rrule)}
                {' · '}
                {t('list.scheduleRecipients', { count: s.recipientCount })}
                {s.paused ? ` · ${t('scheduleDialog.paused')}` : ''}
              </li>
            ))}
          </ul>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
