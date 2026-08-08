import { setRequestLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { isSandboxScenarioId, scenariosForBrand } from '@forma360/shared/sandbox-scenarios';
import { ScenarioPicker } from '../../../src/components/try/scenario-picker';
import { TRY_PAGE } from '../../../src/content/try';
import { activeBrand } from '../../../src/lib/brand';
import { auth } from '../../../src/server/auth';

/**
 * Try-it-now entry point (ADR 0017).
 *
 * Brand-gated by the module catalogue rather than a brand conditional:
 * a brand whose catalogue yields no tiles has no sandbox, and this route
 * 404s there. Signed-in visitors are bounced into the app — provisioning
 * a second workspace would strand the one they already have.
 */
export default async function TryPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tile?: string }>;
}) {
  const { locale } = await params;
  const { tile } = await searchParams;
  setRequestLocale(locale);

  const scenarios = scenariosForBrand(activeBrand.id);
  if (scenarios.length === 0) notFound();

  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (session !== null) redirect(`/${locale}/ai`);

  // Which tile is open is driven by the URL, so the server can render the
  // expanded state. `/try` is the one page in the product that is always
  // a visitor's first, cold, uncached load, and it inherits the whole
  // signed-in client runtime — the tiles paint looking interactive
  // several hundred milliseconds before their onClick exists. React does
  // not replay a discrete event that lands before hydration, so the first
  // click was simply discarded. As a link, it is an ordinary navigation
  // that works with no JavaScript at all.
  const initialSelected =
    isSandboxScenarioId(tile) && scenarios.some((s) => s.id === tile) ? tile : null;

  return (
    <section className="mx-auto max-w-5xl px-4 pb-24 pt-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">
          {TRY_PAGE.eyebrow}
        </p>
        <h1 className="mt-4 text-balance font-display text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          {TRY_PAGE.title}
        </h1>
        <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
          {TRY_PAGE.subtitle}
        </p>
      </div>

      <div className="mt-12">
        <ScenarioPicker locale={locale} scenarios={scenarios} initialSelected={initialSelected} />
      </div>
    </section>
  );
}
