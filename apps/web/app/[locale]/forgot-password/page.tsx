import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ForgotPasswordCard } from '../../../src/components/auth/forgot-password-card';
import { auth } from '../../../src/server/auth';

/**
 * Request-a-reset-link entry point, linked from the sign-in card. Also
 * how an OTP-era account sets its first password — the reset exchange
 * creates the credential row when none exists. Signed-in users are sent
 * into the app: their surface is Settings → Profile → Security.
 */
export default async function ForgotPasswordPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) {
    redirect(`/${locale}/settings/profile`);
  }

  return (
    <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16">
      <ForgotPasswordCard />
    </section>
  );
}
