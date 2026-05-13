'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent } from '../../../../src/components/ui/card';

/**
 * QR codes tab stub. PR-2 will replace this placeholder with the real
 * generator: per-category QR codes that point at a public submission
 * route so observations can be reported without signing in. For PR-1
 * this is just an empty-state card so the sub-nav can surface the tab
 * shape from day one.
 */
export default function QrCodesPage() {
  const t = useTranslations('issues.qrCodes');
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <Card>
        <CardContent className="space-y-2 p-8 text-center">
          <h2 className="text-base font-semibold">{t('emptyTitle')}</h2>
          <p className="text-sm text-muted-foreground">{t('emptyBody')}</p>
        </CardContent>
      </Card>
    </div>
  );
}
