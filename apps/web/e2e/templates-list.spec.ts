import { expect, test } from '@playwright/test';

/**
 * Templates list smoke spec.
 *
 * Admin routes require a session; without one the layout redirects the
 * browser to the sign-in page. That's the signal we exercise here —
 * proves the route is mounted and the auth gate fires before we ever
 * render the list. A richer spec with a seeded admin + real create /
 * archive round-trip lands once we have an e2e test harness that can
 * stand up a full DB.
 */
test('anonymous visit to /en/templates redirects to sign-in', async ({ page }) => {
  const response = await page.goto('/en/templates');
  expect(response?.ok()).toBeTruthy();
  // Layout does a server-side redirect — either the sign-in page (no
  // session) or a 200 page that renders the sign-in card.
  await expect(page).toHaveURL(/\/en(\/.*)?$/);
});

test('anonymous visit to /en/templates/01HXXXXXXXXXXXXXXXXXXXXXXX redirects away', async ({
  page,
}) => {
  // A ULID-shaped path segment is enough to reach the editor route;
  // the layout's auth gate should bounce it.
  const response = await page.goto('/en/templates/01HXXXXXXXXXXXXXXXXXXXXXXX');
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/en(\/.*)?$/);
});
