'use client';

/**
 * The "＋ Report" affordance (navigation review, recommendation 3).
 *
 * Starting something is the most frequent action in the product and it
 * was not in the menu at all: raising a permit or reporting a hazard
 * meant finding the module, then finding its button. This puts the four
 * things people start above the menu, in one tap.
 *
 * Each entry is gated on the permission that actually lets you do it, so
 * a labourer who can only report hazards sees exactly one option — and
 * if they can do none of them, the button does not render.
 *
 * The hazard/incident split is settled by the label rather than left to
 * the menu (recommendation 4): a reporter who is unsure takes the
 * "Not sure which?" route, which asks whether anyone was harmed and
 * sends them to the right module.
 */
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { brandHasModule } from '@forma360/shared/brand';
import { activeBrand } from '../../lib/brand';
import { cn } from '../../lib/cn';
import { useHasPermission } from '../../lib/permissions-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';

export function ReportButton({
  locale,
  collapsed = false,
  onNavigate,
}: {
  locale: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav.report');
  const canReportHazard = useHasPermission('issues.report');
  const canReportIncident =
    useHasPermission('incidents.report') && brandHasModule(activeBrand.id, 'incidents');
  const canRaisePermit =
    useHasPermission('permits.create') && brandHasModule(activeBrand.id, 'permits');
  const canInspect = useHasPermission('inspections.conduct');

  const options: Array<{ key: string; href: string }> = [
    ...(canReportHazard ? [{ key: 'hazard', href: `/${locale}/observations/new` }] : []),
    ...(canReportIncident ? [{ key: 'incident', href: `/${locale}/incidents/new` }] : []),
    ...(canRaisePermit ? [{ key: 'permit', href: `/${locale}/permits/new` }] : []),
    ...(canInspect ? [{ key: 'inspection', href: `/${locale}/inspections` }] : []),
  ];

  if (options.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'mb-3 flex items-center gap-2 rounded-md bg-brand py-2 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90',
            collapsed ? 'justify-center px-2' : 'px-3',
          )}
          {...(collapsed ? { title: t('label'), 'aria-label': t('label') } : {})}
        >
          <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
          {collapsed ? null : <span className="truncate">{t('label')}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {options.map((option) => (
          <DropdownMenuItem key={option.key} asChild>
            <Link
              href={option.href}
              {...(onNavigate !== undefined ? { onClick: onNavigate } : {})}
              className="flex cursor-pointer flex-col items-start gap-0.5"
            >
              <span className="font-medium">{t(`options.${option.key}.label` as never)}</span>
              <span className="text-xs text-muted-foreground">
                {t(`options.${option.key}.hint` as never)}
              </span>
            </Link>
          </DropdownMenuItem>
        ))}
        {canReportHazard && canReportIncident ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link
                href={`/${locale}/report`}
                {...(onNavigate !== undefined ? { onClick: onNavigate } : {})}
                className="cursor-pointer text-xs text-muted-foreground"
              >
                {t('notSure')}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
