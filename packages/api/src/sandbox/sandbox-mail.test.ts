/**
 * SB-M01..M04 — a try-it-now workspace cannot mail strangers.
 *
 * A sandbox hands an Administrator session to a visitor who has proven
 * nothing: no email, no payment, no identity. Administrator holds every key
 * in the catalogue, so the permission set is built by SUBTRACTION — which
 * means every key added to the catalogue after the withhold list was written
 * is granted automatically. That is how `analytics.schedules.manage` came to
 * be granted: dashboards landed later and brought a mail path with them
 * (20 free-text recipients, no domain check, hourly floor, a rendered PDF
 * attached, sent from the verified domain).
 *
 * These tests pin the list so removing an entry has to be deliberate, and
 * assert the property that matters — no mail-to-arbitrary-address key is
 * reachable from a sandbox.
 */
import { PERMISSION_KEYS, type PermissionKey } from '@forma360/permissions/catalogue';
import { describe, expect, it } from 'vitest';
import { SANDBOX_WITHHELD_PERMISSIONS, sandboxPermissionKeys } from './provision';

/**
 * Every catalogue key whose module can put a message in front of an address
 * the tenant does not own. Adding a key here without withholding it fails
 * SB-M02, which is the point.
 */
const MAIL_TO_ARBITRARY_ADDRESS: readonly PermissionKey[] = [
  'users.invite',
  'contractors.manage',
  'analytics.schedules.manage',
];

describe('sandbox permissions (guard)', () => {
  const granted = new Set<string>(sandboxPermissionKeys());

  it('SB-M01: the withheld list is exactly what we think it is', () => {
    expect([...SANDBOX_WITHHELD_PERMISSIONS].sort()).toEqual(
      ['analytics.schedules.manage', 'contractors.manage', 'users.invite'].sort(),
    );
  });

  it('SB-M02: no key that can mail an arbitrary address is granted', () => {
    const leaked = MAIL_TO_ARBITRARY_ADDRESS.filter((k) => granted.has(k));
    expect(
      leaked,
      'These keys let an anonymous sandbox mail strangers from the verified sending domain',
    ).toEqual([]);
  });

  it('SB-M03: everything else in the catalogue is still granted — the tiles depend on it', () => {
    const withheld = new Set<string>(SANDBOX_WITHHELD_PERMISSIONS);
    const expected = PERMISSION_KEYS.filter((k) => !withheld.has(k));
    expect(sandboxPermissionKeys()).toEqual(expected);
    // Sanity: a sandbox is still an administrator for everything harmless.
    expect(granted.has('org.settings')).toBe(true);
    expect(granted.has('permits.issue')).toBe(true);
  });

  it('SB-M04: withholding a key that is not in the catalogue is a mistake', () => {
    const catalogue = new Set<string>(PERMISSION_KEYS);
    const unknown = SANDBOX_WITHHELD_PERMISSIONS.filter((k) => !catalogue.has(k));
    expect(unknown, 'A renamed key silently stops being withheld').toEqual([]);
  });
});
