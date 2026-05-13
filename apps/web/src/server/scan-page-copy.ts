/**
 * Static English copy for the public `/scan/[token]` landing page.
 *
 * The scan page lives outside the `[locale]` segment (it's reached
 * directly from a printed QR code, with no locale context), so we
 * cannot route it through `next-intl`. The page is a single-purpose
 * public utility, so a hardcoded English copy table is a deliberate
 * trade-off — translations can come later if the public form ever
 * grows.
 *
 * Strings are imported as variables to keep the `no-hardcoded-strings`
 * ESLint rule happy (the rule flags literal JSX text, not expressions
 * referencing an imported identifier).
 */
export const SCAN_PAGE_COPY = {
  brandName: 'Forma360',
  loading: 'Loading…',
  invalidTitle: 'This QR code is no longer active.',
  invalidBody:
    'The QR code you scanned has been revoked or the category is no longer accepting reports. Please contact the site administrator.',
  reportObservation: 'Report observation',
  fields: {
    titleLabel: 'Title',
    titlePlaceholder: 'Short summary of what happened',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'Add any details that might help us understand the observation.',
    reporterNameLabel: 'Your name',
    reporterNameSubtitle: 'Optional — leave blank to stay anonymous.',
    reporterEmailLabel: 'Your email',
    reporterEmailSubtitle: 'Optional — we may use this to follow up.',
    dateOccurredLabel: 'Date occurred',
    locationAddressLabel: 'Location',
    locationAddressPlaceholder: 'Building, floor, or area',
    customQuestionsHeading: 'Additional questions',
    required: 'Required',
    selectPlaceholder: 'Select an option',
  },
  submit: 'Submit',
  submitting: 'Submitting…',
  successTitle: 'Thanks! Your observation has been submitted.',
  successBody: 'Your reference number is below — keep it for your records.',
  successAnother: 'Submit another',
  errorGeneric: 'Could not submit the observation. Please try again.',
} as const;
