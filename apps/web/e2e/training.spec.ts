import { expect, test } from '@playwright/test';
import { brandHasModule, resolveBrandId } from '@forma360/shared/brand';

/**
 * Training & competence matrix — web-path smoke (FreeHS B7).
 *
 * The review's structural finding, now written up four modules running:
 * *"no test touches a web path"*, and every defect it found lived in one.
 * Six router procedures shipped with no UI caller because nothing
 * exercised the pages.
 *
 * These run unauthenticated, so they assert what can be asserted without a
 * session: that every route the module claims to have actually **exists
 * and is gated** rather than 404ing — which is precisely the class of
 * defect the review found ("the last one shipped a 404 on its primary
 * button"). A signed-in journey belongs in the authenticated suite where
 * the OTP helper lives.
 *
 * Training is a FreeHS-only module (ADR 0010): under any other brand
 * `training/layout.tsx` deliberately `notFound()`s every route, so the
 * assertion flips by brand. `NEXT_PUBLIC_BRAND` is the same value the
 * server was built with (absent ⇒ the default brand), so a run against
 * the local webServer matches what it serves — which is why the whole
 * suite was red under the default-brand CI until this became brand-aware.
 */
const brandShipsTraining = brandHasModule(
  resolveBrandId(process.env.NEXT_PUBLIC_BRAND),
  'training',
);

/** Every route the module ships, including the three that had no page. */
const ROUTES = [
  '/en/training',
  '/en/training/matrix',
  '/en/training/compliance',
  '/en/training/requirements',
  // TR-A4 / TR-A5: the wallet and the personal door.
  '/en/training/me',
  '/en/training/person',
  // TR-B3: the id-addressed wallet Cmd-K resolves to. Before this route
  // existed the palette sent every training hit to a 404.
  '/en/training/person/01KPFAKETESTIDAAAAAAAAAAAA',
];

for (const route of ROUTES) {
  test(`${route} is gated for anonymous visitors`, async ({ page }) => {
    const response = await page.goto(route);
    if (brandShipsTraining) {
      // Not a 404: the page is wired. Not a 500: the layout's brand and
      // permission gates run cleanly.
      expect(response?.status()).toBeLessThan(400);
      // Gated: an anonymous visitor lands on sign-in, never on the matrix.
      await expect(page).toHaveURL(/\/sign-in/);
    } else {
      // The active brand doesn't ship training, so the brand gate must
      // 404 the route — never leak the page, never 500.
      expect(response?.status()).toBe(404);
    }
  });
}

test('the certificate upload endpoint refuses an anonymous POST', async ({ request }) => {
  // TR-A11b added this route; it must be session- and permission-gated,
  // not an open upload sink.
  const response = await request.post('/api/upload/training-certificate', {
    multipart: {
      entityId: '01KPFAKETESTIDAAAAAAAAAAAA',
      file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from([1, 2, 3]) },
    },
    failOnStatusCode: false,
  });
  expect([401, 403, 404]).toContain(response.status());
});
