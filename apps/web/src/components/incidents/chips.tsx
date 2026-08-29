'use client';

/**
 * Shared row/header tokens for the incidents module, redesigned on user
 * feedback ("too many alert colours"): the old version filled every cell
 * with a differently-hued pill — purple Confidential, sky/amber/orange/red
 * severity ramp, six status colours, amber Late report, solid-red RIDDOR —
 * so a single row could carry six hues and the register read as a wall of
 * alarms with no way to rank them.
 *
 * The colour budget now: **hue means a statutory clock, nothing else.**
 * - red    → a RIDDOR deadline has been missed (the one true alarm here)
 * - amber  → a statutory clock is running (≤ 5 days)
 * - everything else is ink: severity is a monochrome intensity ramp
 *   (dot + text weight), status and kind are plain text, Confidential is
 *   a lock, Late report is a muted note. Facts read quietly; only the
 *   thing that demands action today gets a colour.
 */
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Car,
  Check,
  Droplets,
  Eye,
  HeartPulse,
  Lock,
  Siren,
  Syringe,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

const KIND_ICONS: Record<string, JSX.Element> = {
  injury: <HeartPulse className="h-3.5 w-3.5" />,
  ill_health: <Activity className="h-3.5 w-3.5" />,
  dangerous_occurrence: <AlertOctagon className="h-3.5 w-3.5" />,
  sharps_exposure: <Syringe className="h-3.5 w-3.5" />,
  violence_aggression: <Siren className="h-3.5 w-3.5" />,
  damage: <Car className="h-3.5 w-3.5" />,
  environmental: <Droplets className="h-3.5 w-3.5" />,
  near_miss: <Eye className="h-3.5 w-3.5" />,
};

export function KindChip({ kind }: { kind: string }) {
  const t = useTranslations('incidents.kinds');
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {KIND_ICONS[kind] ?? <AlertOctagon className="h-3.5 w-3.5" />}
      {t(kind as never)}
    </span>
  );
}

/**
 * Severity as ink intensity, not hue: the dot darkens and the text
 * gains weight as the level rises. A "major" row is unmistakably heavier
 * than a "negligible" one without a single coloured pixel — colour stays
 * reserved for the statutory clock.
 */
const SEVERITY_DOT: Record<string, string> = {
  negligible: 'border border-muted-foreground/50 bg-transparent',
  minor: 'bg-muted-foreground/40',
  moderate: 'bg-muted-foreground/70',
  serious: 'bg-muted-foreground',
  major: 'bg-foreground',
};

const SEVERITY_TEXT: Record<string, string> = {
  negligible: 'text-muted-foreground',
  minor: 'text-muted-foreground',
  moderate: 'text-foreground',
  serious: 'font-medium text-foreground',
  major: 'font-semibold text-foreground',
};

export function SeverityChip({ severity }: { severity: string }) {
  const t = useTranslations('incidents.severities');
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${SEVERITY_TEXT[severity] ?? 'text-muted-foreground'}`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[severity] ?? 'bg-muted-foreground/40'}`}
        aria-hidden
      />
      {t(severity as never)}
    </span>
  );
}

/**
 * Status is a workflow position, not an alert: plain text, foreground
 * while the incident is live, muted once it is terminal. "Reopened"
 * carries weight (it came back) but not colour.
 */
const TERMINAL_STATUSES = new Set(['closed', 'cancelled']);

export function IncidentStatusChip({ status }: { status: string }) {
  const t = useTranslations('incidents.statuses');
  return (
    <span
      className={`inline-flex items-center text-xs ${
        TERMINAL_STATUSES.has(status)
          ? 'text-muted-foreground'
          : status === 'reopened'
            ? 'font-medium text-foreground'
            : 'text-foreground'
      }`}
    >
      {t(status as never)}
    </span>
  );
}

/**
 * The RIDDOR clock — the only place on the register allowed a hue.
 * Muted while distant or resolved, amber text inside 5 days, red text
 * once the statutory deadline is missed. Text tokens, not filled slabs:
 * one overdue row should read as the loudest thing on the page precisely
 * because nothing else is shouting.
 */
export function RiddorChip({
  category,
  deadlineAt,
  submittedAt,
}: {
  category: string | null;
  deadlineAt: string | Date | null;
  submittedAt: string | Date | null;
}) {
  const t = useTranslations('incidents.riddor');
  if (category === null) return null;
  if (category === 'not_reportable') {
    return (
      <span className="inline-flex items-center text-xs text-muted-foreground">
        {t('chipNotReportable')}
      </span>
    );
  }
  if (submittedAt !== null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5" aria-hidden />
        {t('chipSubmitted')}
      </span>
    );
  }
  if (deadlineAt === null) return null;
  const deadline = typeof deadlineAt === 'string' ? new Date(deadlineAt) : deadlineAt;
  const msLeft = deadline.getTime() - Date.now();
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  if (msLeft <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        {t('chipOverdue')}
      </span>
    );
  }
  const urgent = daysLeft <= 5;
  return (
    <span
      className={`inline-flex items-center text-xs ${
        urgent ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground'
      }`}
    >
      {t('chipDaysLeft', { days: daysLeft })}
    </span>
  );
}

/** A fact about when it was reported, not an alarm: a muted note. */
export function LateReportChip() {
  const t = useTranslations('incidents.list');
  return (
    <span className="inline-flex items-center text-xs text-muted-foreground">
      {t('lateReport')}
    </span>
  );
}

/** Confidentiality is a property, not a warning: a lock, in ink. */
export function ConfidentialChip() {
  const t = useTranslations('incidents.list');
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="h-3 w-3" aria-hidden />
      {t('confidential')}
    </span>
  );
}
