import { expect, freehsOnly, openAnonymously, test } from './fixtures/sandbox';

freehsOnly();

/**
 * Public token routes — the surfaces people WITHOUT a seat see.
 *
 * The NR3-01 regression class lives here: both `/s/[token]` and
 * `/scan/[token]` mount outside the localised layout, and a provider
 * change once 500'd every public share page silently. These journeys
 * pin that the public shells render for real tokens, degrade politely
 * for dead ones, and that the QR observation round-trip works end to
 * end — admin mints a QR code, a stranger reports through it, the
 * report lands in the register.
 */

test.describe('QR observation round-trip', () => {
  test('mint a QR code, report anonymously through it, see it in the register', async ({
    page,
    context,
    sandbox,
  }) => {
    test.setTimeout(90_000);
    await sandbox({ scenarioId: 'hazard', refinementId: 'withActions' });

    // Admin side: Observations → QR codes tab → create one for a category.
    await page.getByRole('link', { name: 'QR codes' }).click();
    // Level-pinned: the create sheet's own "Create observation QR code"
    // heading can coexist with the page h1.
    await expect(page.getByRole('heading', { level: 1, name: 'QR codes' })).toBeVisible();
    await page.getByRole('button', { name: 'Create QR code' }).first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Create observation QR code')).toBeVisible();
    await sheet.getByLabel('Category').selectOption({ label: 'Hazard' });
    await sheet.getByRole('button', { name: 'Create', exact: true }).click();

    // The show dialog auto-opens with the fresh token; the URL input is
    // populated by a client effect, so wait for a non-empty value.
    const urlInput = page.getByLabel('Public URL');
    await expect(urlInput).toHaveValue(/\/scan\/.+/, { timeout: 15_000 });
    const scanUrl = new URL(await urlInput.inputValue());

    // Stranger side: a cookie-less browser context reports through it.
    const anon = await openAnonymously(context, scanUrl.pathname);
    try {
      // UXW2-02: the frame speaks the worker's word — the heading composes
      // "Report: <category>" rather than leading with the product noun.
      await expect(anon.page.getByRole('heading', { name: /Report: / })).toBeVisible({
        timeout: 15_000,
      });
      await anon.page.getByLabel(/^Title/).fill('E2E — leaking hydraulic hose near dock 2');
      await anon.page.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(
        anon.page.getByRole('heading', { name: 'Thanks! Your report has been submitted.' }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await anon.context.close();
    }

    // Back on the signed-in side, the report is in the register.
    await page.goto('/en/observations');
    await expect(
      page.getByRole('cell', { name: 'E2E — leaking hydraulic hose near dock 2' }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('a dead scan token renders the polite dead-end, not an error page', async ({ context }) => {
    const anon = await openAnonymously(context, '/scan/this-token-does-not-exist');
    try {
      // The shell must render (public intl provider intact — NR3-01) and
      // say the code is inactive, never a 500 or a raw digest page.
      await expect(
        anon.page.getByRole('heading', { name: 'This QR code is no longer active.' }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await anon.context.close();
    }
  });
});

test.describe('share-link route /s/[token]', () => {
  test('an unknown share token renders the designed dead-end', async ({ context }) => {
    const anon = await openAnonymously(context, '/s/this-token-does-not-exist');
    try {
      // UXW3-03: unknown/revoked tokens render a branded dead-end page —
      // the person holding a dead link may have signed the document behind
      // it, and a bare 404 read as "the evidence is gone". The regression
      // this originally guarded against (a 500 with an empty body from a
      // provider crash in the public layout) stays covered: the page must
      // answer 200 with our copy, never a crash page.
      const response = await anon.page.request.get('/s/this-token-does-not-exist');
      expect(response.status()).toBe(200);
      await anon.page.goto('/s/this-token-does-not-exist');
      await expect(
        anon.page.getByRole('heading', { name: 'This link is no longer active.' }),
      ).toBeVisible();
    } finally {
      await anon.context.close();
    }
  });
});
