'use client';

/**
 * Shared chip components for the incidents module: kind (with icon),
 * severity (colour-ramped), lifecycle status, and the RIDDOR deadline
 * countdown chip the register + detail header use. Mirrors the permits
 * chips so the two registers read as one product.
 */
import {
  Activity,
  AlertOctagon,
  Car,
  Droplets,
  Eye,
  HeartPulse,
  Siren,
  Syringe,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

const KIND_ICONS: Record<string, JSX.Element> = {
  injury: <HeartPulse className="h-3 w-3" />,
  ill_health: <Activity className="h-3 w-3" />,
  dangerous_occurrence: <AlertOctagon className="h-3 w-3" />,
  sharps_exposure: <Syringe className="h-3 w-3" />,
  violence_aggression: <Siren className="h-3 w-3" />,
  damage: <Car className="h-3 w-3" />,
  environmental: <Droplets className="h-3 w-3" />,
  near_miss: <Eye className="h-3 w-3" />,
};

export function KindChip({ kind }: { kind: string }) {
  const t = useTranslations('incidents.kinds');
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">
      {KIND_ICONS[kind] ?? <AlertOctagon className="h-3 w-3" />}
      {t(kind as never)}
    </span>
  );
}

const SEVERITY_CLASSES: Record<string, string> = {
  negligible: 'bg-muted text-muted-foreground border',
  minor: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200',
  moderate: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  serious: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200',
  major: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
};

export function SeverityChip({ severity }: { severity: string }) {
  const t = useTranslations('incidents.severities');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_CLASSES[severity] ?? 'bg-muted'}`}
    >
      {t(severity as never)}
    </span>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  reported: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200',
  triaged: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200',
  investigating: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  actions_outstanding: 'bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200',
  closed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  reopened: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
  cancelled: 'bg-muted text-muted-foreground border',
};

export function IncidentStatusChip({ status }: { status: string }) {
  const t = useTranslations('incidents.statuses');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status] ?? 'bg-muted'}`}
    >
      {t(status as never)}
    </span>
  );
}

/**
 * RIDDOR clock chip: quiet grey while distant, amber inside 5 days, red
 * when overdue; green once the submission is recorded.
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
      <span className="inline-flex items-center rounded-full border bg-background px-2 py-0.5 text-xs text-muted-foreground">
        {t('chipNotReportable')}
      </span>
    );
  }
  if (submittedAt !== null) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">
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
      <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
        {t('chipOverdue')}
      </span>
    );
  }
  const urgent = daysLeft <= 5;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        urgent
          ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200'
          : 'border bg-background text-muted-foreground'
      }`}
    >
      {t('chipDaysLeft', { days: daysLeft })}
    </span>
  );
}

export function LateReportChip() {
  const t = useTranslations('incidents.list');
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      {t('lateReport')}
    </span>
  );
}

export function ConfidentialChip() {
  const t = useTranslations('incidents.list');
  return (
    <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-900 dark:bg-purple-900/40 dark:text-purple-200">
      {t('confidential')}
    </span>
  );
}
