import { expect, test } from '@playwright/test';

/**
 * Phase 0 smoke test.
 *
 * Verifies: an anonymous visit to / redirects to /<detected-locale>, the
 * sign-in form renders with its translated title, and x-request-id shows
 * up on the response header.
 */
test('root redirects to /en and renders sign-in', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  // Middleware may serve the content inline or via a 307 — the final URL
  // must carry a locale prefix either way.
  await expect(page).toHaveURL(/\/(en|es|fr|de|pt|it|nl|pl|ja|zh)(\/.*)?$/);

  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  await expect(page.getByLabel(/email/i)).toBeVisible();
  await expect(page.getByLabel(/password/i)).toBeVisible();
});

test('theme toggle is present on the header', async ({ page }) => {
  await page.goto('/en');
  await expect(page.getByRole('button', { name: /toggle theme/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /change language/i })).toBeVisible();
});

test('x-request-id is echoed on the response header', async ({ request }) => {
  const response = await request.get('/en', {
    headers: { 'x-request-id': '01KPFAKETESTIDAAAAAAAAAAAA' },
  });
  expect(response.status()).toBeLessThan(400);
  const echoed = response.headers()['x-request-id'];
  expect(echoed).toBe('01KPFAKETESTIDAAAAAAAAAAAA');
});
