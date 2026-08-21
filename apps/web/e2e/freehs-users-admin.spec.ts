import { expect, freehsOnly, test } from './fixtures/sandbox';

freehsOnly();

/**
 * Settings → Users admin register.
 *
 * The reworked page splits the register into four views — Active
 * (default), Deactivated, Contractors, Invitations — with one search box
 * over all of them and a permission-set column. The seeded sandbox
 * carries two users (the visitor "You" and colleague "Priya Shah"), no
 * contractor portal users and no pending invitations, which exercises
 * every view's populated or empty state plus the full
 * deactivate → appears-in-Deactivated → reactivate round trip.
 */

test.describe('users admin register', () => {
  test('views, search, permission sets, deactivate/reactivate round trip', async ({
    page,
    sandbox,
  }) => {
    test.setTimeout(90_000);
    await sandbox({ scenarioId: 'hazard', refinementId: 'withActions' });
    await page.goto('/en/settings/users');

    // Active view is the default and lists both seeded users with their
    // permission sets.
    await expect(page.getByRole('tab', { name: /Active/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('cell', { name: 'Priya Shah' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'You', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Permission set' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Administrator (trial)' })).toBeVisible();

    // Search narrows the register (server-side, so it scales past the
    // first page of users).
    await page.getByRole('searchbox', { name: 'Search name or email…' }).fill('Priya');
    await expect(page.getByRole('cell', { name: 'You', exact: true })).toBeHidden();
    await expect(page.getByRole('cell', { name: 'Priya Shah' })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search name or email…' }).clear();

    // Contractors and Invitations views render their empty states — the
    // sandbox seeds contractor COMPANIES but no portal users.
    await page.getByRole('tab', { name: /Contractors/ }).click();
    await expect(page.getByText('No contractor users yet', { exact: false })).toBeVisible();
    await page.getByRole('tab', { name: /Invitations/ }).click();
    await expect(page.getByText('Pending invitations', { exact: true })).toBeVisible();

    // Deactivate Priya from Active, find her under Deactivated,
    // reactivate, and see her return.
    await page.getByRole('tab', { name: /Active/ }).click();
    const priyaRow = page.getByRole('row', { name: /Priya Shah/ });
    await priyaRow.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByRole('cell', { name: 'Priya Shah' })).toBeHidden({ timeout: 15_000 });

    await page.getByRole('tab', { name: /Deactivated/ }).click();
    const deactivatedRow = page.getByRole('row', { name: /Priya Shah/ });
    await expect(deactivatedRow).toBeVisible();
    await deactivatedRow.getByRole('button', { name: 'Reactivate' }).click();
    await expect(page.getByRole('cell', { name: 'Priya Shah' })).toBeHidden({ timeout: 15_000 });

    await page.getByRole('tab', { name: /Active/ }).click();
    await expect(page.getByRole('cell', { name: 'Priya Shah' })).toBeVisible();
  });
});
