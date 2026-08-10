'use client';

/**
 * First-load palette derivation for company-email sign-ups (ADR 0018).
 *
 * When the founder signs up with a company email, `signUpWithTenant` seeds
 * `branding.websiteUrl` from the email domain and sets
 * `autoDeriveFromWebsite`. This component — mounted once in the signed-in
 * shell for administrators — turns that into a real palette on first load:
 * it POSTs the website to the SSRF-guarded `/api/ai/brand-palette` route,
 * persists the returned colours via `tenants.updateBranding` (which clears
 * the flag, since it rebuilds the branding block from the keys we pass),
 * then refreshes so the server re-emits the tenant theme.
 *
 * Best-effort and silent: any failure leaves the standard brand in place,
 * with the website still pre-filled in Company settings for a manual retry.
 * It renders nothing.
 */
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '../../lib/trpc/client';

interface ProposedPalette {
  primaryColor: string;
  accentColor: string;
  chartColors: string[];
}

export function BrandingAutoDerive({
  websiteUrl,
  enabled,
}: {
  /** The https company website seeded from the sign-up email domain. */
  websiteUrl: string;
  /** True only when the flag is set, no palette exists yet, and the caller can manage branding. */
  enabled: boolean;
}) {
  const router = useRouter();
  const save = trpc.tenants.updateBranding.useMutation();
  const started = useRef(false);

  useEffect(() => {
    if (!enabled || started.current) return;
    started.current = true;

    void (async () => {
      try {
        const res = await fetch('/api/ai/brand-palette', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: websiteUrl }),
        });
        if (!res.ok) return; // best-effort: keep the standard brand
        const data = (await res.json()) as { palette?: ProposedPalette };
        const palette = data.palette;
        if (palette === undefined) return;
        await save.mutateAsync({
          websiteUrl,
          primaryColor: palette.primaryColor,
          accentColor: palette.accentColor,
          chartColors: palette.chartColors,
        });
        // Re-run the server layout so the new tenant theme is emitted.
        router.refresh();
      } catch {
        // Swallow — the website stays pre-filled for a manual derive.
      }
    })();
  }, [enabled, websiteUrl, save, router]);

  return null;
}
