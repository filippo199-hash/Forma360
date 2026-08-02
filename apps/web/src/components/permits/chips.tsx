'use client';

/**
 * Small shared chips for the Permit to Work module: lifecycle status,
 * permit category (icon + label) and the expiry countdown. One-line
 * presentational pieces the list, board and detail pages share.
 */
import {
  Anchor,
  ArrowUpToLine,
  CircleAlert,
  DoorClosed,
  Flame,
  Gauge,
  Shovel,
  TriangleAlert,
  Warehouse,
  Wind,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

/** Permit category → icon. Labels come from `permits.categories.*`. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  hot_work: Flame,
  confined_space: DoorClosed,
  work_at_height: ArrowUpToLine,
  electrical: Zap,
  excavation: Shovel,
  roof_work: Warehouse,
  asbestos: Wind,
  lifting: Anchor,
  pressure_systems: Gauge,
  other: TriangleAlert,
};

export function CategoryChip({ category, name }: { category: string; name?: string }) {
  const t = useTranslations('permits.categories');
  const Icon = CATEGORY_ICONS[category] ?? TriangleAlert;
  const label = name !== undefined && name.length > 0 ? name : t(category as never);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-xs text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200">
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function PermitStatusChip({ status }: { status: string }) {
  const t = useTranslations('permits.status');
  const known =
    status === 'draft' ||
    status === 'issued' ||
    status === 'active' ||
    status === 'suspended' ||
    status === 'closed' ||
    status === 'cancelled';
  const key = known ? status : 'draft';
  const colors: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    issued: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-100',
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    suspended: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
    closed: 'bg-muted text-muted-foreground',
    cancelled: 'bg-muted text-muted-foreground line-through',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[key] ?? ''}`}>
      {t(key as never)}
    </span>
  );
}

/**
 * Time remaining on an open permit. Red when overdue — the "someone may
 * still be in there" state.
 */
export function CountdownChip({ validTo, overdue }: { validTo: Date | string; overdue: boolean }) {
  const t = useTranslations('permits.countdown');
  const end = typeof validTo === 'string' ? new Date(validTo) : validTo;
  const minutes = Math.floor((end.getTime() - Date.now()) / 60_000);
  if (overdue || minutes < 0) {
    const overBy = Math.abs(Math.min(minutes, 0));
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-900/40 dark:text-red-200">
        <CircleAlert className="h-3 w-3" aria-hidden="true" />
        {overBy >= 60
          ? t('overdueHours', { hours: Math.floor(overBy / 60) })
          : t('overdueMinutes', { minutes: Math.max(overBy, 1) })}
      </span>
    );
  }
  const soon = minutes <= 120;
  const cls = soon
    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100'
    : 'bg-muted text-muted-foreground';
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${cls}`}>
      {minutes >= 60
        ? t('remainingHours', { hours: Math.floor(minutes / 60) })
        : t('remainingMinutes', { minutes })}
    </span>
  );
}
