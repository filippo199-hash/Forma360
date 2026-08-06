/**
 * Public QR-scan landing page — server shell.
 *
 * Lives outside `[locale]` (the URL is printed on physical signage), so the
 * locale comes from the visitor's Accept-Language header instead of a URL
 * segment (PF-11: this page — the one the workforce actually sees — was
 * hardcoded English). The negotiated locale drives a next-intl lookup of the
 * `scanPage` namespace; the copy is passed to the client form as plain
 * strings.
 */
import { DEFAULT_LOCALE, isLocale } from '@forma360/i18n/config';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { activeBrand } from '../../../src/lib/brand';
import { ScanReportForm, type ScanPageCopy } from './scan-report-form';

const MAX_PHOTOS = 3;
const MAX_PHOTO_MB = 10;

/** Pick the best supported locale from an Accept-Language header. */
function negotiateLocale(acceptLanguage: string | null): string {
  if (acceptLanguage === null) return DEFAULT_LOCALE;
  for (const part of acceptLanguage.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? '';
    const primary = tag.split('-')[0] ?? '';
    if (isLocale(tag)) return tag;
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

export default async function ScanReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale = negotiateLocale((await headers()).get('accept-language'));
  const t = await getTranslations({ locale, namespace: 'scanPage' });

  const copy: ScanPageCopy = {
    brandName: activeBrand.name,
    loading: t('loading'),
    invalidTitle: t('invalidTitle'),
    invalidBody: t('invalidBody'),
    reportObservation: t('reportObservation'),
    fields: {
      titleLabel: t('titleLabel'),
      titlePlaceholder: t('titlePlaceholder'),
      descriptionLabel: t('descriptionLabel'),
      descriptionPlaceholder: t('descriptionPlaceholder'),
      reporterNameLabel: t('reporterNameLabel'),
      reporterNameSubtitle: t('reporterNameSubtitle'),
      reporterEmailLabel: t('reporterEmailLabel'),
      reporterEmailSubtitle: t('reporterEmailSubtitle'),
      dateOccurredLabel: t('dateOccurredLabel'),
      locationAddressLabel: t('locationAddressLabel'),
      locationAddressPlaceholder: t('locationAddressPlaceholder'),
      customQuestionsHeading: t('customQuestionsHeading'),
      selectPlaceholder: t('selectPlaceholder'),
      siteLabel: t('siteLabel'),
      siteNone: t('siteNone'),
      photosLabel: t('photosLabel'),
      photosSubtitle: t('photosSubtitle', { max: MAX_PHOTOS }),
      photosAdd: t('photosAdd'),
      photosRemove: t('photosRemove'),
      photoTooLarge: t('photoTooLarge', { maxMb: MAX_PHOTO_MB }),
      photoUploadFailed: t('photoUploadFailed'),
    },
    submit: t('submit'),
    submitting: t('submitting'),
    successTitle: t('successTitle'),
    successBody: t('successBody'),
    successAnother: t('successAnother'),
    errorGeneric: t('errorGeneric'),
  };

  return <ScanReportForm token={token} copy={copy} />;
}

export const dynamic = 'force-dynamic';
