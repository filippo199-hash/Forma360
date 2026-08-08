'use client';

/**
 * Shown wherever the free plan hits the customDashboards gate (ADR 0018).
 * The server refuses with PAYMENT_REQUIRED; this is the friendly face.
 */
import { Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { activeBrand } from '../../lib/brand';
import { Card, CardContent } from '../ui/card';

export function UpgradePanel() {
  const t = useTranslations('dashboards');
  return (
    <Card className="mx-auto mt-12 max-w-lg">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
        <span className="rounded-full bg-primary/10 p-3 text-primary">
          <Sparkles className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-lg font-semibold">{t('upgrade.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('upgrade.body')}</p>
        <a
          href={`mailto:${activeBrand.supportEmail}`}
          className="mt-2 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {t('upgrade.cta')}
        </a>
      </CardContent>
    </Card>
  );
}

/** True when a tRPC error is the paid-plan refusal. */
export function isEntitlementError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof (error as { data?: { code?: string } }).data?.code === 'string' &&
    (error as { data: { code: string } }).data.code === 'PAYMENT_REQUIRED'
  );
}
