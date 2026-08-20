import { expect, freehsOnly, test } from './fixtures/sandbox';

freehsOnly();

/**
 * Incident → triage → RIDDOR screening — the deadline machinery.
 *
 * The incident sandbox seeds `IN-000001` at `reported`: a fall from a
 * step ladder, fractured wrist, hospital admission, an open absence
 * already days long. The seeded facts deliberately carry two independent
 * RIDDOR triggers (specified injury; over-7-day absence), so the
 * screening is a real judgement. The journey drives triage and the
 * screening through the same inline panels a duty holder would use.
 */

const INCIDENT_TITLE = 'Fall from step ladder while changing high-bay lamp';

test.describe('incident triage and RIDDOR screening', () => {
  test('register surfaces the untriaged incident', async ({ page, sandbox }) => {
    await sandbox({ scenarioId: 'incident', refinementId: 'withRiddor' });
    await expect(page.getByRole('heading', { name: 'Incidents' })).toBeVisible();
    // The needs-attention strip counts the untriaged report (ICU plural).
    // The chip splits its count and label across elements, so match the
    // button's accessible name rather than a text node.
    await expect(page.getByRole('button', { name: /1 report awaiting triage/ })).toBeVisible();
    await expect(page.getByRole('cell', { name: INCIDENT_TITLE })).toBeVisible();
  });

  test('triage, screen as a specified injury, record the HSE submission', async ({
    page,
    sandbox,
  }) => {
    test.setTimeout(120_000);
    await sandbox({ scenarioId: 'incident', refinementId: 'withRiddor' });

    // Incident rows navigate via row onClick (no link element); click
    // the desktop table cell.
    await page.getByRole('cell', { name: INCIDENT_TITLE }).click();
    await expect(page.getByRole('heading', { name: INCIDENT_TITLE })).toBeVisible({
      timeout: 15_000,
    });

    // Triage: severity is seeded serious, which floors the investigation
    // level to Full — pick the lead and confirm. Like the screening
    // below, the whole phase is one retry block: a straggler refetch can
    // remount the card and close the panel mid-interaction, so every
    // step fails fast and the block resumes from wherever the UI
    // actually is. Terminal state: the opener is gone (status left
    // `reported`).
    const triageOpener = page.getByRole('button', { name: 'Triage this incident' });
    const confirmTriage = page.getByRole('button', { name: 'Confirm triage' });
    await expect(async () => {
      const panelOpen = await confirmTriage.isVisible();
      if (!panelOpen) {
        if (!(await triageOpener.isVisible())) return; // already triaged
        await triageOpener.click({ timeout: 2_000 });
        await expect(confirmTriage).toBeVisible({ timeout: 2_000 });
      }
      if (!(await confirmTriage.isEnabled())) {
        // The people picker is a popover: toggle the option, then commit
        // with Done — without the commit the draft never lands.
        await page
          .getByRole('button', { name: 'Choose the investigator…' })
          .click({ timeout: 2_000 });
        await page.getByRole('button', { name: /Priya Shah/ }).click({ timeout: 2_000 });
        await page.getByRole('button', { name: 'Done', exact: true }).click({ timeout: 2_000 });
        await expect(confirmTriage).toBeEnabled({ timeout: 2_000 });
      }
      await confirmTriage.click({ timeout: 2_000 });
      await expect(triageOpener).toBeHidden({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // RIDDOR: not yet screened → screen now.
    await expect(page.getByText(/Not yet screened\. The determination — including/)).toBeVisible({
      timeout: 15_000,
    });

    // The whole screening interaction runs inside one retry block: a
    // straggler refetch from the triage invalidation can remount the
    // card and silently CLOSE the panel mid-interaction (seen in a
    // trace — the panel opened, a late `incidents.get` landed, the
    // panel was gone). Every step uses a short timeout so a collapsed
    // panel fails fast and the block re-opens it and starts over; the
    // recorded determination is the terminal state that ends the loop.
    const determination = page.getByText(/Determination:.*Specified injury/);
    const specifiedInjury = page.getByRole('radio', { name: /Specified injury/ });
    await expect(async () => {
      if (await determination.isVisible()) return;
      if (!(await specifiedInjury.isVisible())) {
        await page.getByRole('button', { name: 'Screen now' }).click({ timeout: 2_000 });
      }
      // The seeded facts: fractured wrist (not finger/thumb/toe) — a
      // specified injury under RIDDOR 2013 reg 4.
      await specifiedInjury.check({ timeout: 2_000 });
      // The reasoning textarea's visible "Reasoning" label is not
      // programmatically associated; its name is the placeholder.
      await page
        .getByRole('textbox', { name: /Why this determination/ })
        .fill(
          'Fractured wrist confirmed at hospital — a fracture other than to fingers, thumbs or toes is a specified injury.',
          { timeout: 2_000 },
        );
      await page.getByRole('button', { name: 'Record determination' }).click({ timeout: 2_000 });
      await expect(determination).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // The determination is the record: category, screener, deadline.
    await expect(page.getByText(/Statutory deadline:/)).toBeVisible();

    // Record the HSE submission; the panel is replaced by the frozen
    // submission line.
    await expect(async () => {
      await page.getByRole('button', { name: 'Record HSE submission' }).click();
      await expect(page.getByRole('button', { name: 'Record submission' })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Record submission' }).click();
    await expect(page.getByText(/Submitted:.*HSE online form/)).toBeVisible({ timeout: 15_000 });
  });
});
