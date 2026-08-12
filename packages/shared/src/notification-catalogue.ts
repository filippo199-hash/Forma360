/**
 * Notification catalogue — the single source of truth for what a user can
 * be notified about and how (settings → notifications).
 *
 * Every kind here is deliverable over BOTH channels: an email send and an
 * in-app bell row, each individually per-user toggleable. Preferences live
 * on `user.notificationPrefs` (jsonb `Record<string, boolean>`) under keys
 * of the form `email:<kind>` / `inapp:<kind>`; a missing key means
 * ENABLED. Three pre-catalogue keys (`emailActionReminders`,
 * `emailScheduleMissed`, `emailDocumentExpiry`) are honoured as fallbacks
 * so choices users saved before the catalogue existed keep working.
 *
 * What is deliberately NOT here:
 *   - account/transactional mail (otp, invite, password-reset,
 *     contractor-portal-invite) — a user must not be able to mute their
 *     own sign-in code;
 *   - sends to free-text addresses with no user row (dashboard schedule
 *     recipients, template notify-triggers, contractor document contacts)
 *     — there is no user to hold a preference.
 *
 * Adding a kind: add the entry here, add `notifications.kinds.<kind>` to
 * every locale bundle (the catalogue-labels guard test fails CI
 * otherwise), then dispatch through `@forma360/api/notify` so both
 * channels respect the preference.
 */
import type { BrandId, BrandOnlyModule } from './brand';
import { BRAND_MODULES } from './brand';

export const NOTIFICATION_CHANNELS = ['email', 'inapp'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Display groups, in the order the settings table renders them. */
export const NOTIFICATION_GROUPS = [
  'actions',
  'inspections',
  'observations',
  'headsUp',
  'documents',
  'training',
  'riskAssessments',
  'permits',
  'fireSafety',
  'incidents',
  'contractors',
  'org',
] as const;
export type NotificationGroup = (typeof NOTIFICATION_GROUPS)[number];

interface NotificationEventShape {
  /** Machine kind — also the `notifications.kind` column value. */
  kind: string;
  group: NotificationGroup;
  /** When set, the row only exists for brands shipping this module. */
  brandModule?: BrandOnlyModule;
}

/**
 * One entry per user-facing notification event. `kind` values double as
 * the in-app `notifications.kind` column and the i18n label key
 * (`notifications.kinds.<kind>`), so existing bell kinds keep their names.
 */
export const NOTIFICATION_EVENTS = [
  // Actions
  { kind: 'action_assigned', group: 'actions' },
  { kind: 'action_due', group: 'actions' },
  // Inspections & schedules
  { kind: 'schedule_reminder', group: 'inspections' },
  { kind: 'schedule_missed', group: 'inspections' },
  { kind: 'approval_pending', group: 'inspections' },
  { kind: 'approval_decided', group: 'inspections' },
  { kind: 'signature_request', group: 'inspections' },
  { kind: 'signature_complete', group: 'inspections' },
  // Observations
  { kind: 'issue_reported', group: 'observations' },
  { kind: 'observation_notification', group: 'observations' },
  { kind: 'observation_critical', group: 'observations' },
  // Heads Up
  { kind: 'heads_up', group: 'headsUp' },
  // Documents
  { kind: 'document_expiry', group: 'documents' },
  // Training (brand-gated)
  { kind: 'training_expiry', group: 'training', brandModule: 'training' },
  { kind: 'training_expiry_recorder', group: 'training', brandModule: 'training' },
  // Risk assessments (brand-gated)
  { kind: 'ra_distributed', group: 'riskAssessments', brandModule: 'riskAssessments' },
  { kind: 'ra_ack_reminder', group: 'riskAssessments', brandModule: 'riskAssessments' },
  // Permits (brand-gated)
  { kind: 'permit_expiry', group: 'permits', brandModule: 'permits' },
  // Fire safety (brand-gated)
  { kind: 'fire_due_digest', group: 'fireSafety', brandModule: 'fireSafety' },
  { kind: 'fra_intolerable', group: 'fireSafety', brandModule: 'fireSafety' },
  // Incidents (brand-gated)
  { kind: 'incident_alert', group: 'incidents', brandModule: 'incidents' },
  { kind: 'incident_investigator_assigned', group: 'incidents', brandModule: 'incidents' },
  { kind: 'incident_riddor', group: 'incidents', brandModule: 'incidents' },
  { kind: 'incident_chase', group: 'incidents', brandModule: 'incidents' },
  // Contractors
  { kind: 'contractor_overstay', group: 'contractors' },
  // Organisation
  { kind: 'request_to_join', group: 'org' },
] as const satisfies readonly NotificationEventShape[];

export type NotificationEventDef = (typeof NOTIFICATION_EVENTS)[number];
export type NotificationKind = NotificationEventDef['kind'];

export const NOTIFICATION_KINDS: readonly NotificationKind[] = NOTIFICATION_EVENTS.map(
  (e) => e.kind,
);

export function isNotificationKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

/** Pref-map key for one (kind, channel) cell, e.g. `email:action_due`. */
export function notificationPrefKey(kind: NotificationKind, channel: NotificationChannel): string {
  return `${channel}:${kind}`;
}

/**
 * Pre-catalogue pref keys (PF-23 shipped exactly these three email
 * toggles). Read as fallbacks only — writes always use the new shape.
 */
const LEGACY_EMAIL_PREF_KEYS: Partial<Record<NotificationKind, string>> = {
  action_due: 'emailActionReminders',
  schedule_missed: 'emailScheduleMissed',
  document_expiry: 'emailDocumentExpiry',
};

/**
 * Whether a user has this (kind, channel) enabled. Missing key = enabled;
 * an explicit new-shape key wins over a legacy key.
 */
export function notificationEnabled(
  prefs: Record<string, boolean>,
  kind: NotificationKind,
  channel: NotificationChannel,
): boolean {
  const explicit = prefs[notificationPrefKey(kind, channel)];
  if (explicit !== undefined) return explicit;
  if (channel === 'email') {
    const legacyKey = LEGACY_EMAIL_PREF_KEYS[kind];
    if (legacyKey !== undefined) {
      const legacy = prefs[legacyKey];
      if (legacy !== undefined) return legacy;
    }
  }
  return true;
}

/** Catalogue rows that exist for this brand (brand-only modules filtered). */
export function notificationEventsForBrand(brandId: BrandId): NotificationEventDef[] {
  const modules = BRAND_MODULES[brandId];
  return NOTIFICATION_EVENTS.filter(
    (e) => !('brandModule' in e) || modules.includes(e.brandModule),
  );
}
