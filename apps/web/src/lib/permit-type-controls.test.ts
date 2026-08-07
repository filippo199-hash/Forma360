/**
 * "The permit types page can set every field `typeUpdateInput` accepts."
 *
 * This is the assertion the round-2 review named, verbatim, as the one
 * that would have caught TR-B1 — the competence gate that was wired
 * server-side and could not be switched on, because `requiredTrainingIds`
 * appeared in the router, the schema, the helper and the tests, and **in
 * no `.tsx` file at all**.
 *
 * It is deliberately a source-level test rather than a browser one. The
 * defect class is "the server grew a field and the admin screen didn't",
 * and that is decidable by reading both files — no session, no database,
 * no sign-in page to stop one step short of.
 *
 * Fields that are genuinely edited elsewhere are listed as exemptions
 * with the reason, so this test states the contract rather than merely
 * counting.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Keys on `typeUpdateInput` that are edited on a different surface. */
const EDITED_ELSEWHERE: Record<string, string> = {
  typeId: 'the identifier, not a field',
  preconditions: 'edited in the precondition editor on the same page',
  gasLimits: 'edited in the gas-limits block on the same page',
};

function readSource(relative: string): string {
  return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

/** Keys of the `typeUpdateInput` zod object in the permits router. */
function typeUpdateFields(): string[] {
  const source = readSource('../../packages/api/src/routers/permits.ts');
  const start = source.indexOf('const typeUpdateInput = z.object({');
  expect(start, 'permits router still defines typeUpdateInput').toBeGreaterThan(-1);
  // Up to the closing `});` of that literal.
  const body = source.slice(start, source.indexOf('\n});', start));
  return [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1] as string);
}

describe('permit types admin screen', () => {
  it('TR-B1: every updatable field has a control on the types page', () => {
    const page = readSource('app/[locale]/permits/types/page.tsx');
    const missing = typeUpdateFields()
      .filter((f) => EDITED_ELSEWHERE[f] === undefined)
      .filter((f) => !page.includes(f));

    expect(
      missing,
      `permits/types/page.tsx cannot set: ${missing.join(', ')} — a server field with no admin control is a feature that ships switched off and cannot be switched on`,
    ).toEqual([]);
  });

  it('TR-B1: the competence gate specifically is armable from the UI', () => {
    // Named on its own because it is the module's stated justification:
    // an empty `requiredTrainingIds` on all nine seeded types means the
    // delivered behaviour is byte-for-byte what it was before the gate.
    const page = readSource('app/[locale]/permits/types/page.tsx');
    expect(page).toContain('requiredTrainingIds');
    // …and it reads the catalogue to offer real choices.
    expect(page).toContain('training.listRequirements');
  });

  it('TR-B1: both gate refusals are translatable, not a generic shrug', () => {
    // `issue` throws these two slugs; an unregistered slug falls through
    // to "something went wrong", which at the job face tells the issuer
    // nothing — no names, no reason.
    const errors = readSource('src/components/permits/permit-error.tsx');
    expect(errors).toContain("'training-expired'");
    expect(errors).toContain("'training-missing'");

    const en = JSON.parse(
      readFileSync(resolve(process.cwd(), '../../packages/i18n/messages/en.json'), 'utf8'),
    ) as { permits: { errors: Record<string, string> } };
    expect(en.permits.errors['training-expired']).toBeTypeOf('string');
    expect(en.permits.errors['training-missing']).toBeTypeOf('string');
  });

  it('TR-B1: the permit page previews the shortfall and blocks Issue on it', () => {
    // The server has returned `trainingShortfalls` since the gate was
    // wired; the page rendering nothing is what made it invisible.
    const page = readSource('app/[locale]/permits/[permitId]/page.tsx');
    expect(page).toContain('trainingShortfalls');
    // It must feed the Issue button's disabled expression, not just render
    // a warning the issuer can press straight past.
    const disabledBlock = page.slice(
      page.indexOf('disabled={'),
      page.indexOf('signatures.issueAction'),
    );
    expect(disabledBlock).toContain('trainingShortfalls');
  });
});
