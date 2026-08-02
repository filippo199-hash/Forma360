'use client';

/**
 * Small shared chips for the COSHH module: GHS pictograms, special-regime
 * flags, SDS review-age status and assessment status. Kept together —
 * they're all one-line presentational pieces the list, detail and editor
 * pages share.
 */
import {
  Bomb,
  Flame,
  FlaskConical,
  HeartPulse,
  Leaf,
  CircleAlert,
  Cylinder,
  Droplets,
  Skull,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

/** GHS pictogram code → icon. Labels come from `coshh.pictograms.*`. */
const PICTOGRAM_ICONS: Record<string, LucideIcon> = {
  GHS01: Bomb,
  GHS02: Flame,
  GHS03: FlaskConical,
  GHS04: Cylinder,
  GHS05: Droplets,
  GHS06: Skull,
  GHS07: CircleAlert,
  GHS08: HeartPulse,
  GHS09: Leaf,
};

export function PictogramChips({ codes }: { codes: ReadonlyArray<string> }) {
  const t = useTranslations('coshh.pictograms');
  if (codes.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {codes.map((code) => {
        const Icon = PICTOGRAM_ICONS[code] ?? CircleAlert;
        return (
          <span
            key={code}
            title={t(code as never)}
            className="inline-flex items-center gap-1 rounded-md border border-orange-300 bg-orange-50 px-1.5 py-0.5 text-xs text-orange-900 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-200"
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            <span className="hidden lg:inline">{t(code as never)}</span>
          </span>
        );
      })}
    </span>
  );
}

export interface RegimeFlagsView {
  isCarcinogen: boolean;
  isMutagen: boolean;
  isAsthmagen: boolean;
  isBiologicalAgent: boolean;
  containsLead: boolean;
  asbestosReferral: boolean;
}

/** Special-regime chips — the loud ones. Renders nothing when all false. */
export function RegimeChips({ flags }: { flags: RegimeFlagsView }) {
  const t = useTranslations('coshh.regimes');
  const entries: Array<{ key: string; active: boolean }> = [
    { key: 'carcinogen', active: flags.isCarcinogen },
    { key: 'mutagen', active: flags.isMutagen },
    { key: 'asthmagen', active: flags.isAsthmagen },
    { key: 'biological', active: flags.isBiologicalAgent },
    { key: 'lead', active: flags.containsLead },
    { key: 'asbestos', active: flags.asbestosReferral },
  ];
  const active = entries.filter((e) => e.active);
  if (active.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {active.map((e) => (
        <span
          key={e.key}
          className="rounded-md bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200"
        >
          {t(e.key as never)}
        </span>
      ))}
    </span>
  );
}

export function SdsStatusChip({ status }: { status: 'missing' | 'review_due' | 'current' }) {
  const t = useTranslations('coshh.sds.status');
  const colors: Record<typeof status, string> = {
    missing: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    review_due: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-100',
    current: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[status]}`}>
      {t(status)}
    </span>
  );
}

export function AssessmentStatusChip({ status }: { status: string }) {
  const t = useTranslations('coshh.assessmentStatus');
  const normalised = status === 'draft' || status === 'active' || status === 'archived';
  const key = normalised ? status : 'draft';
  const colors: Record<string, string> = {
    draft: 'bg-muted text-muted-foreground',
    active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-100',
    archived: 'bg-muted text-muted-foreground line-through',
  };
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${colors[key] ?? ''}`}>
      {t(key as never)}
    </span>
  );
}
