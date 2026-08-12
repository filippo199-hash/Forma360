/**
 * Notification catalogue invariants (NP-E01..E06). The catalogue is the
 * contract between the settings table, the dispatch helper and every
 * worker/router that notifies a user — these tests pin the parts that
 * would fail silently if broken.
 */
import { describe, expect, it } from 'vitest';
import { BRAND_MODULES } from './brand';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  isNotificationKind,
  notificationEnabled,
  notificationEventsForBrand,
  notificationPrefKey,
} from './notification-catalogue';

describe('notification catalogue', () => {
  it('NP-E01: kinds are unique and every event belongs to a declared group', () => {
    expect(new Set(NOTIFICATION_KINDS).size).toBe(NOTIFICATION_EVENTS.length);
    for (const e of NOTIFICATION_EVENTS) {
      expect(NOTIFICATION_GROUPS).toContain(e.group);
    }
  });

  it('NP-E02: brand-gated events reference real brand-only modules', () => {
    const known = new Set(Object.values(BRAND_MODULES).flat());
    for (const e of NOTIFICATION_EVENTS) {
      if ('brandModule' in e) expect(known.has(e.brandModule)).toBe(true);
    }
  });

  it('NP-E03: default is enabled on both channels for every kind', () => {
    for (const kind of NOTIFICATION_KINDS) {
      for (const channel of NOTIFICATION_CHANNELS) {
        expect(notificationEnabled({}, kind, channel)).toBe(true);
      }
    }
  });

  it('NP-E04: an explicit pref disables exactly its own (kind, channel) cell', () => {
    for (const kind of NOTIFICATION_KINDS) {
      for (const channel of NOTIFICATION_CHANNELS) {
        const prefs = { [notificationPrefKey(kind, channel)]: false };
        expect(notificationEnabled(prefs, kind, channel)).toBe(false);
        // The sibling channel is untouched.
        const other = channel === 'email' ? 'inapp' : 'email';
        expect(notificationEnabled(prefs, kind, other)).toBe(true);
        // Every other kind is untouched, on both channels.
        for (const otherKind of NOTIFICATION_KINDS) {
          if (otherKind === kind) continue;
          expect(notificationEnabled(prefs, otherKind, 'email')).toBe(true);
          expect(notificationEnabled(prefs, otherKind, 'inapp')).toBe(true);
        }
      }
    }
  });

  it('NP-E05: legacy PF-23 keys still silence their email — and only their email', () => {
    const legacy: Array<[string, (typeof NOTIFICATION_KINDS)[number]]> = [
      ['emailActionReminders', 'action_due'],
      ['emailScheduleMissed', 'schedule_missed'],
      ['emailDocumentExpiry', 'document_expiry'],
    ];
    for (const [legacyKey, kind] of legacy) {
      const prefs = { [legacyKey]: false };
      expect(notificationEnabled(prefs, kind, 'email')).toBe(false);
      expect(notificationEnabled(prefs, kind, 'inapp')).toBe(true);
      // A new-shape key beats the legacy key when both are present.
      expect(
        notificationEnabled(
          { [legacyKey]: false, [notificationPrefKey(kind, 'email')]: true },
          kind,
          'email',
        ),
      ).toBe(true);
    }
  });

  it('NP-E06: brand filtering — Forma360 sees no brand-only rows, FreeHS sees all', () => {
    const forma = notificationEventsForBrand('forma360');
    expect(forma.some((e) => 'brandModule' in e)).toBe(false);
    const freehs = notificationEventsForBrand('freehs');
    expect(freehs.length).toBe(NOTIFICATION_EVENTS.length);
    expect(isNotificationKind('action_due')).toBe(true);
    expect(isNotificationKind('not_a_kind')).toBe(false);
  });
});
