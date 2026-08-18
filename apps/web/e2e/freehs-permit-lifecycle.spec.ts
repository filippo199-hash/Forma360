import { expect, freehsOnly, test } from './fixtures/sandbox';

freehsOnly();

/**
 * Permit-to-work lifecycle — the legally loaded FreeHS journey.
 *
 * The permit sandbox seeds `PTW-0001` already ISSUED, with the visitor
 * as the named acceptor: preconditions ticked, one in-range gas reading,
 * authorised and issued by a colleague. The open decision is the
 * visitor's sign-on — accept → the permit goes active — and from there
 * the close-out checks take it to closed. That is issued → active →
 * closed exercised through the real UI, signatures card and all.
 */

const PERMIT_TITLE = 'Welding repair to conveyor frame — Line 3';

test.describe('permit lifecycle', () => {
  test('register shows the seeded permit awaiting the visitor', async ({ page, sandbox }) => {
    await sandbox({ scenarioId: 'permit', refinementId: 'hotWork' });
    await expect(page.getByRole('heading', { name: 'Permits to work' })).toBeVisible();
    // Role-scoped to the desktop table — the reference also renders in
    // the (hidden) mobile card list, which trips strict mode.
    await expect(page.getByRole('cell', { name: 'PTW-0001' })).toBeVisible();
    await expect(page.getByRole('link', { name: PERMIT_TITLE }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Issued' })).toBeVisible();
  });

  test('accept as the named acceptor, then close out', async ({ page, sandbox }) => {
    test.setTimeout(120_000);
    await sandbox({ scenarioId: 'permit', refinementId: 'hotWork' });
    await page.getByRole('link', { name: PERMIT_TITLE }).first().click();

    // The detail page: the permit title is the h1; the signatures card
    // carries the acceptance decision.
    await expect(page.getByRole('heading', { name: PERMIT_TITLE })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Signatures' })).toBeVisible();

    // The Refuse button must render its ENGLISH label. Until this pass,
    // `permits.detail.signatures.refuseAction` (and three sibling keys)
    // were mis-nested under `evidence.` in every locale bundle, so the
    // button printed the raw dotted key path on the live product.
    await expect(page.getByRole('button', { name: 'Refuse', exact: true })).toBeVisible();
    await expect(page.getByText('permits.detail.')).toHaveCount(0);

    // Accept: confirms via the shared appConfirm dialog.
    await page.getByRole('button', { name: 'Accept permit' }).click();
    const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'));
    await expect(confirmDialog.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Confirm' }).click();

    // issued → active.
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });

    // Close-out: all four checks, then close. The permit page's actions
    // card expands inline (no dialog).
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('Close-out checks — all four must be confirmed')).toBeVisible();
    for (const label of [
      'Work complete or stopped safely',
      'Area inspected and made safe',
      'Isolations removed or reinstated as agreed',
      'All personnel accounted for and clear',
    ]) {
      await page.getByLabel(label).check();
    }
    await page.getByRole('button', { name: 'Close permit' }).click();

    // active → closed.
    await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('permit PDF export answers with a real PDF', async ({ page, context, sandbox }) => {
    await sandbox({ scenarioId: 'permit', refinementId: 'hotWork' });
    await page.getByRole('link', { name: PERMIT_TITLE }).first().click();
    const pdfLink = page.getByRole('link', { name: 'Download PDF' });
    await expect(pdfLink).toBeVisible({ timeout: 15_000 });
    const href = await pdfLink.getAttribute('href');
    expect(href).toContain('/api/exports/permit-pdf');
    // Fetch through the signed-in context: the response must be a PDF,
    // not an error payload in a new tab (the export-delivery class).
    const response = await context.request.get(href ?? '');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type'] ?? '').toContain('pdf');
    const body = await response.body();
    expect(body.subarray(0, 5).toString()).toContain('%PDF');
  });
});
