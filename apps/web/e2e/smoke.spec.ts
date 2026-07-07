import { expect, test } from '@playwright/test';

/**
 * Boot smoke test. Verifies the app serves, the locale redirect works, the
 * (passwordless email-OTP) sign-in form renders, and x-request-id is echoed.
 *
 * NB: sign-in is email-OTP only — there is no password field, and the
 * dedicated route is `/<locale>/sign-in` (the root is a marketing landing).
 */
test('root redirects to a locale', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  // Middleware may serve inline or via a 307 — the final URL must carry a
  // locale prefix either way.
  await expect(page).toHaveURL(/\/(en|es|fr|de|pt|it|nl|pl|ja|zh)(\/.*)?$/);
});

test('sign-in page renders the email-OTP form', async ({ page }) => {
  await page.goto('/en/sign-in');
  // Passwordless email-OTP: an email input is present; there is no password.
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test('x-request-id is echoed on the response header', async ({ request }) => {
  const response = await request.get('/en', {
    headers: { 'x-request-id': '01KPFAKETESTIDAAAAAAAAAAAA' },
  });
  expect(response.status()).toBeLessThan(400);
  const echoed = response.headers()['x-request-id'];
  expect(echoed).toBe('01KPFAKETESTIDAAAAAAAAAAAA');
});
