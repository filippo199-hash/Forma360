import { setRequestLocale } from 'next-intl/server';
import {
  ResetLinkInvalidCard,
  ResetPasswordCard,
} from '../../../src/components/auth/reset-password-card';

/**
 * Landing page for the emailed reset link. better-auth's
 * `GET /api/auth/reset-password/:token` validates the token and
 * redirects here with `?token=` when valid or `?error=INVALID_TOKEN`
 * when not. Deliberately usable with an active session: someone
 * following a reset link after a "wasn't me" notification must never be
 * bounced away from it.
 */
export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>;
}) {
  const { locale } = await params;
  const { token, error } = await searchParams;
  setRequestLocale(locale);

  const tokenParam = typeof token === 'string' && token.length > 0 ? token : null;
  const hasError = typeof error === 'string' && error.length > 0;

  return (
    <section className="mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-6xl items-center justify-center px-4 py-16">
      {tokenParam === null || hasError ? (
        <ResetLinkInvalidCard />
      ) : (
        <ResetPasswordCard token={tokenParam} />
      )}
    </section>
  );
}
