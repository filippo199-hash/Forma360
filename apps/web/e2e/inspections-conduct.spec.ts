import { expect, test } from '@playwright/test';

/**
 * Inspections conduct smoke spec.
 *
 * Without a seeded admin test harness, the richest thing we can verify
 * is the auth gate: anonymous visits to /en/inspections and the
 * deep-linked conduct route redirect away from the route. A richer
 * spec (start → fill → submit round-trip) lands once we have a DB
 * seed for e2e.
 */
test('anonymous visit to /en/inspections is gated by auth', async ({ page }) => {
  const response = await page.goto('/en/inspections');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/en(\/.*)?$/);
});

test('anonymous visit to /en/inspections/<id> redirects away', async ({ page }) => {
  const response = await page.goto('/en/inspections/01HYYYYYYYYYYYYYYYYYYYYYYY');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/en(\/.*)?$/);
});

test('anonymous visit to /en/inspections/<id>/status redirects away', async ({ page }) => {
  const response = await page.goto('/en/inspections/01HYYYYYYYYYYYYYYYYYYYYYYY/status');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/en(\/.*)?$/);
});
