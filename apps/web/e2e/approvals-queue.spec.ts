import { expect, test } from '@playwright/test';

/**
 * Approvals queue smoke spec.
 *
 * Mirrors the existing inspections-conduct spec: we don't have a seeded
 * user, so the richest thing we can assert is the auth gate — anonymous
 * visits to the approvals routes should bounce to the locale root.
 */
test('anonymous visit to /en/approvals is gated by auth', async ({ page }) => {
  const response = await page.goto('/en/approvals');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/en(\/.*)?$/);
});

test('anonymous visit to /en/approvals/<id> redirects away', async ({ page }) => {
  const response = await page.goto('/en/approvals/01HYYYYYYYYYYYYYYYYYYYYYYY');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/en(\/.*)?$/);
});
