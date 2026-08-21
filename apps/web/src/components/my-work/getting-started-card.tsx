'use client';

import { CheckCircle2, Circle } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useHasPermission } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

/**
 * The first-run "Set up your workspace" checklist (UXW1-03/06), mounted
 * above the My work queue. Admin-only, derived entirely from the real
 * registers via `onboarding.status` (never stamped, so it cannot
 * disagree with the data), and gone once every step is done, the admin
 * dismisses it, or the workspace is an unclaimed sandbox.
 */
const STEP_LINKS = {
  sites: '/sites',
  team: '/settings/users',
  riskAssessment: '/risk-assessments',
  template: '/templates',
  qr: '/observations/qr-codes',
} as const;
type StepKey = keyof typeof STEP_LINKS;
const STEP_ORDER: readonly StepKey[] = ['sites', 'team', 'riskAssessment', 'template', 'qr'];

export function GettingStartedCard() {
  const isAdmin = useHasPermission('org.settings');
  const t = useTranslations('onboarding');
  const locale = useLocale();
  const utils = trpc.useUtils();
  const status = trpc.onboarding.status.useQuery(undefined, { enabled: isAdmin });
  const dismiss = trpc.onboarding.dismiss.useMutation({
    onSuccess: () => void utils.onboarding.status.invalidate(),
  });

  if (!isAdmin || status.data === undefined) return null;
  const { steps, dismissed, isSandbox } = status.data;
  if (dismissed || isSandbox || STEP_ORDER.every((key) => steps[key])) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dismiss.mutate()}
          disabled={dismiss.isPending}
        >
          {t('dismiss')}
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {STEP_ORDER.map((key) => (
            <li key={key} className="flex items-center gap-2 text-sm">
              {steps[key] ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              {steps[key] ? (
                <span className="text-muted-foreground line-through">{t(`steps.${key}`)}</span>
              ) : (
                <Link
                  href={`/${locale}${STEP_LINKS[key]}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {t(`steps.${key}`)}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
