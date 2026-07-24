import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignInCard } from '../../../src/components/home/sign-in-card';
import { safeNextPath } from '../../../src/lib/sign-in-redirect';
import { auth } from '../../../src/server/auth';

/**
 * Passwordless sign-in entry point. The public homepage links here, as do the
 * module layouts when they bounce an unauthenticated caller — carrying a
 * `?next=` deep link (S9.6). Signed-in callers are sent straight to `next`
 * (or the default), guarded against open-redirect.
 */
export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { locale } = await params;
  const { next } = await searchParams;
  const nextParam = typeof next === 'string' ? next : null;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) {
    redirect(safeNextPath(nextParam, locale));
  }

  return (
    <section className="mx-auto flex max-w-6xl items-center justify-center px-4 py-16">
      <SignInCard next={nextParam} />
    </section>
  );
}
