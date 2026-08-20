import { expect, freehsOnly, test } from './fixtures/sandbox';

freehsOnly();

/**
 * RAMS pack journeys.
 *
 * Two sandbox forks matter here:
 *  - `buildPack` seeds a draft pack (`RAMS-000001`) whose four
 *    method-statement steps live in `draftContent` — the builder must
 *    render them, and the issue gate must name what still blocks issue.
 *    The builder route itself shipped MISSING twice (the RS-A1 class:
 *    linked from the pack page, never committed), which is exactly why
 *    this spec walks through the link rather than deep-navigating.
 *  - `reviewPack` seeds a contractor pack pending review — the receive
 *    side of RAMS, which is the page that tile lands on.
 */

const PACK_TITLE = 'Conveyor frame repair — hot works, Line 3';

test.describe('RAMS pack builder', () => {
  test('draft pack page names its issue blockers and opens the builder', async ({
    page,
    sandbox,
  }) => {
    test.setTimeout(90_000);
    await sandbox({ scenarioId: 'rams', refinementId: 'buildPack' });

    await expect(page.getByRole('heading', { name: 'RAMS' })).toBeVisible();
    await page.getByRole('link', { name: PACK_TITLE }).first().click();
    await expect(page.getByRole('heading', { name: PACK_TITLE })).toBeVisible({
      timeout: 15_000,
    });

    // The issue gate is the pack page's primary card. The seeded draft
    // has steps and emergency arrangements but no bound risk assessment,
    // so the gate must say so — a pack that issues unbound would be the
    // headline-rule regression (`unreferencedHighRiskHazards`' family).
    await expect(page.getByRole('heading', { name: 'Before you can issue' })).toBeVisible();
    await expect(page.getByText('Bind at least one risk assessment.')).toBeVisible();

    // Through the pack page's own link — the RS-A1 class made this
    // route ship missing while every deep link to it 404'd.
    await page.getByRole('link', { name: 'Open the builder' }).click();
    await expect(page.getByRole('heading', { name: PACK_TITLE })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Sequence of works' })).toBeVisible();

    // All four seeded steps render as collapsible rows.
    for (const step of [
      'Isolate and prepare the work area',
      'Protect the sprinkler head and clear combustibles',
      'Weld the replacement bracket',
      'Fire watch, reinstate and hand back',
    ]) {
      await expect(page.getByRole('button', { name: step })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Add step' })).toBeVisible();
  });
});

test.describe('contractor RAMS review queue', () => {
  test('the seeded contractor pack waits in the review queue', async ({ page, sandbox }) => {
    await sandbox({ scenarioId: 'rams', refinementId: 'reviewPack' });

    // The tile's contract: land on /rams with a contractor pack pending.
    await expect(page.getByText(/1 contractor pack(s)? to review/)).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('link', { name: 'Contractor RAMS review' }).click();
    await expect(
      page.getByText('Halden Electrical — LV distribution board upgrade RAMS'),
    ).toBeVisible({ timeout: 15_000 });
  });
});
