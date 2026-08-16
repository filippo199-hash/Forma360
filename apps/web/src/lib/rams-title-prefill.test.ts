/**
 * BUG-12: starting a pack from a template concatenated into the job
 * title. The stale-closure half was fixed with a functional updater;
 * this pins the remaining decision logic — a prefill may only ever
 * replace an empty field or an earlier prefill, never the user's text.
 */
import { describe, expect, it } from 'vitest';
import { nextTitleOnTemplatePick } from './rams-title-prefill';

describe('nextTitleOnTemplatePick (BUG-12)', () => {
  it('prefills an empty field and takes ownership', () => {
    expect(nextTitleOnTemplatePick('', null, 'Lifting operation')).toEqual({
      title: 'Lifting operation',
      prefill: 'Lifting operation',
    });
  });

  it('treats a whitespace-only field as empty', () => {
    expect(nextTitleOnTemplatePick('   ', null, 'Lifting operation').title).toBe(
      'Lifting operation',
    );
  });

  it('replaces an untouched previous prefill when switching template A → B', () => {
    expect(
      nextTitleOnTemplatePick('Lifting operation', 'Lifting operation', 'Roof access'),
    ).toEqual({ title: 'Roof access', prefill: 'Roof access' });
  });

  it('never touches text the user typed', () => {
    expect(
      nextTitleOnTemplatePick('Bay 2 to Bay 4 crane move', 'Lifting operation', 'Roof access'),
    ).toEqual({ title: 'Bay 2 to Bay 4 crane move', prefill: 'Lifting operation' });
  });

  it('prefills again after the user cleared the field', () => {
    // Ownership was released on the manual edit (prefill = null), and an
    // empty field is fair game for the next pick.
    expect(nextTitleOnTemplatePick('', null, 'Roof access')).toEqual({
      title: 'Roof access',
      prefill: 'Roof access',
    });
  });
});
