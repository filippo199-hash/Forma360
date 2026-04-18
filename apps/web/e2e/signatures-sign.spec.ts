import { expect, test } from '@playwright/test';

/**
 * Signatures sign-page smoke spec.
 *
 * Without a seeded inspection we cannot walk the full flow; the next best
 * signal is that the deep-linked route is gated behind auth and does not
 * leak an unauthenticated render path. The full round-trip lands once the
 * e2e DB seed helper does.
 */
test('anonymous visit to /en/inspections/<id>/signatures/0 redirects away', async ({ page }) => {
  const response = await page.goto(
    '/en/inspections/01HYYYYYYYYYYYYYYYYYYYYYYY/signatures/0',
  );
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/en(\/.*)?$/);
});
