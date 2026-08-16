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
  // TR-B1: the competence gate's two verdicts. Without these the issuer
  // at the job face got "something went wrong" with no names and no reason.
  'training-expired',
  'training-missing',
  // PW-X03: the third verdict — named on the permit, but not a linked
  // account, so no record can be attributed to them with certainty.
  'training-unverifiable-identity',
  // PW-S01 / PW-X01: refusals the person at the job face has to be able
  // to act on. "Already inside" tells the standby they are looking at a
  // register that already has that body on it.
  'already-inside',
  'document-not-visible',
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
  // NR-03: a reading physically impossible in its unit (−5 %, 9999 % LEL).
  'gas-reading-out-of-bounds',
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
