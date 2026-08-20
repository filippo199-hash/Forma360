import { expect, freehsOnly, test, uniqueClientIp } from './fixtures/sandbox';

freehsOnly();

/**
 * FreeHS acquisition funnel — the `/try` sandbox (ADR 0017).
 *
 * This is the front door of the product: an anonymous visitor picks a
 * job, gets a seeded workspace and a real session. It is also the
 * harness every other FreeHS journey spec stands on, so this file keeps
 * the funnel itself honest end to end — tiles render, the two-level
 * picker works, provisioning signs the visitor in, and the workspace
 * they land in is populated rather than an empty shell.
 *
 * Copy assertions quote `src/content/try.ts` (English-only marketing
 * surface by convention) — if the funnel copy changes, change both.
 */

test.describe('try-it-now funnel', () => {
  test('/try renders the scenario tiles', async ({ page }) => {
    await page.goto('/en/try');
    await expect(page.getByText('What do you need to get done?')).toBeVisible();
    // All six FreeHS tiles — the brand ships every module, so every
    // tile must be offered. A missing tile means brand gating broke.
    // Tiles are the links carrying `?tile=`; plain text matching would
    // also hit the marketing footer's module links.
    const tiles = page.locator('a[href*="?tile="]');
    await expect(tiles).toHaveCount(6);
    for (const scenario of [
      'riskAssessment',
      'inspection',
      'hazard',
      'permit',
      'incident',
      'rams',
    ]) {
      await expect(page.locator(`a[href*="?tile=${scenario}"]`)).toBeVisible();
    }
  });

  test('picking a tile builds a workspace and signs the visitor in', async ({ page }, testInfo) => {
    // The creation endpoint rate-limits per client IP via `x-real-ip`;
    // locally that header is absent and every run shares one bucket, so
    // repeated local runs would exhaust the 5/hour cap. Stamp a unique
    // address onto the browser-initiated call, same as the API fixture.
    await page.route('**/api/sandbox/create', async (route) => {
      await route.continue({
        headers: {
          ...route.request().headers(),
          'x-real-ip': `10.98.${testInfo.workerIndex % 256}.${Math.floor(Math.random() * 200) + 1}`,
        },
      });
    });

    await page.goto('/en/try');
    await page.locator('a[href*="?tile=permit"]').click();
    // Level 2: the permit refinements, hot work pre-selected.
    await expect(page.getByRole('button', { name: 'Hot work' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Hot work is the pre-selected default refinement — continue as a
    // hurried visitor would, with one tap.
    await page.getByRole('button', { name: 'Build my workspace' }).click();

    // Provision + redirect. The visitor must land INSIDE the app,
    // signed in, on the permits register.
    await page.waitForURL('**/en/permits**', { timeout: 30_000 });

    // Signed-in proof: a subsequent app navigation is not bounced to
    // sign-in the way the anonymous smoke tests are.
    await page.goto('/en/permits');
    await expect(page).not.toHaveURL(/sign-in/);
  });

  test('API-provisioned workspace lands on a populated register', async ({ page, sandbox }) => {
    const { landingPath } = await sandbox({ scenarioId: 'hazard', refinementId: 'withActions' });
    expect(landingPath).toBe('/observations');
    await expect(page).toHaveURL(/\/en\/observations/);
    // The tile's contract (SANDBOX_SCENARIOS goal): three observations,
    // two open and one closed. An empty register here means the seeds
    // regressed — the exact failure the goal tests exist to prevent.
    await expect(page.getByRole('main')).not.toHaveText(/no observations/i);
  });

  test('an unknown scenario is refused, not defaulted', async ({ context }, testInfo) => {
    const response = await context.request.post('/api/sandbox/create', {
      data: { scenarioId: 'permit', refinementId: 'not-a-real-refinement' },
      headers: { 'x-real-ip': uniqueClientIp(testInfo.workerIndex) },
    });
    expect(response.status()).toBe(400);
  });
});
