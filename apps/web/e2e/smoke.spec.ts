import { expect, test } from '@playwright/test';

/**
 * Boot smoke test. Verifies the app serves, the locale redirect works, the
 * sign-in form renders (password-first, with the email-OTP flow one click
 * away), and x-request-id is echoed.
 *
 * NB: the dedicated route is `/<locale>/sign-in` (the root is a marketing
 * landing).
 */
test('root redirects to a locale', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  // Middleware may serve inline or via a 307 — the final URL must carry a
  // locale prefix either way.
  await expect(page).toHaveURL(/\/(en|es|fr|de|pt|it|nl|pl|ja|zh)(\/.*)?$/);
});

test('sign-in page renders the password form with an OTP alternative', async ({ page }) => {
  await page.goto('/en/sign-in');
  // Password-first: email + password inputs and a forgot-password link.
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
  await expect(page.locator('a[href="/en/forgot-password"]')).toBeVisible();
  // The passwordless flow is one click away and swaps the form over.
  await page.getByRole('button', { name: 'Email me a one-time code instead' }).click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('input[type="email"]')).toBeVisible();
});

test('x-request-id is echoed on the response header', async ({ request }) => {
  const response = await request.get('/en', {
    headers: { 'x-request-id': '01KPFAKETESTIDAAAAAAAAAAAA' },
  });
  expect(response.status()).toBeLessThan(400);
  const echoed = response.headers()['x-request-id'];
  expect(echoed).toBe('01KPFAKETESTIDAAAAAAAAAAAA');
});
