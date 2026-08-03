'use client';

/**
 * Maps the incidents router's error slugs (e.g. 'riddor-unscreened') to
 * the translated `incidents.errors.*` copy. Anything unrecognised — a
 * Zod message, a network error — falls back to the generic line rather
 * than leaking internals.
 */
import { useTranslations } from 'next-intl';

const KNOWN_SLUGS = new Set([
  'module-disabled',
  'incident-not-found',
  'site-not-found',
  'user-not-found',
  'permit-not-found',
  'contractor-not-found',
  'asset-not-found',
  'observation-not-found',
  'occurred-in-future',
  'invalid-details',
  'invalid-transition',
  'incident-terminal',
  'not-editable',
  'not-allowed',
  'confidential',
  'severity-frozen',
  'not-lead-investigator',
  'investigation-already-open',
  'investigation-not-found',
  'investigation-frozen',
  'investigation-not-draft',
  'investigation-not-submitted',
  'immediate-cause-required',
  'conclusion-required',
  'rca-method-required',
  'why-chain-required',
  'causal-factors-required',
  'root-cause-required',
  'approver-is-investigator',
  'sole-manager-justification-required',
  'investigation-level-below-floor',
  'investigation-content-exists',
  'not-triaged',
  'finding-assignee-required',
  'finding-due-date-required',
  'finding-not-found',
  'finding-has-action',
  'person-not-found',
  'absence-not-found',
  'absence-inverted',
  'riddor-already-submitted',
  'riddor-not-reportable',
  'riddor-unscreened',
  'riddor-rescreen-required',
  'riddor-not-submitted',
  'actions-open',
  'incident-not-closed',
  'effectiveness-not-scheduled',
  'invalid-storage-key',
  'nothing-selected',
  'risk-assessment-not-found',
  'coshh-assessment-not-found',
  'fra-not-found',
  'render-unavailable',
]);

export function useIncidentErrorText(): (err: unknown) => string {
  const t = useTranslations('incidents.errors');
  return (err: unknown): string => {
    const message =
      err !== null && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : '';
    if (KNOWN_SLUGS.has(message)) {
      return t(message as never);
    }
    return t('generic');
  };
}

export function IncidentErrorText({ error }: { error: unknown }) {
  const toText = useIncidentErrorText();
  if (error === null || error === undefined) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {toText(error)}
    </p>
  );
}
