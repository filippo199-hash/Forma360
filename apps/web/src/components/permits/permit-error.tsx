'use client';

/**
 * Maps the permits router's error slugs (e.g. 'gas-test-required') to the
 * translated `permits.errors.*` copy. Anything unrecognised — a Zod
 * message, a network error — falls back to the generic line rather than
 * leaking internals.
 */
import { useTranslations } from 'next-intl';

const KNOWN_SLUGS = new Set([
  'module-disabled',
  'unknown-site',
  'unknown-user',
  'type-archived',
  'duplicate-name',
  'duplicate-precondition-id',
  'window-invalid',
  'window-too-long',
  'window-past',
  'acceptor-required',
  'issuer-is-acceptor',
  'preconditions-incomplete',
  'gas-test-required',
  'isolation-certificate-required',
  'rescue-plan-required',
  'authorisation-required',
  'simops-conflict',
  'invalid-transition',
  'not-draft',
  'unknown-precondition',
  'already-authorised',
  'authoriser-is-acceptor',
  'not-the-acceptor',
  'resume-confirmation-required',
  'extension-not-later',
  'extension-too-long',
  'reauthorisation-required',
  'acceptor-is-issuer',
  'same-acceptor',
  'not-allowed',
  'closure-checks-incomplete',
  // HSE-review hardening slugs.
  'gas-test-out-of-range',
  'gas-test-stale',
  'unknown-gas-limit',
  'gas-unit-mismatch',
  'risk-assessment-required',
  'unknown-risk-assessment',
  'unknown-document',
  'extension-in-past',
  'acceptor-is-authoriser',
  'site-scope',
  'entrants-still-inside',
  'unknown-worker',
  'name-required',
  'entry-log-full',
  'unknown-entry',
  'already-exited',
  'render-unavailable',
]);

export function usePermitErrorText(): (message: string | null) => string | null {
  const t = useTranslations('permits.errors');
  return (message: string | null) => {
    if (message === null) return null;
    return KNOWN_SLUGS.has(message) ? t(message as never) : t('generic');
  };
}

export function PermitErrorText({ message }: { message: string | null }) {
  const toText = usePermitErrorText();
  const text = toText(message);
  if (text === null) return null;
  return <p className="text-sm text-red-600 dark:text-red-400">{text}</p>;
}
