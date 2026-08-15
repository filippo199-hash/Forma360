'use client';

/**
 * IANA timezone picker (BUG-14, per-site).
 *
 * A picker rather than a text field, deliberately. ICU accepts bare
 * abbreviations and resolves them to something nobody means — `BST` is
 * Bangladesh Standard Time, six hours off the British Summer Time whoever
 * typed it meant — so a permit stamped with a typed value can print six
 * hours out. The server refuses those, and this makes sure nobody has to
 * discover that by being refused.
 *
 * The empty option means "inherit", which is the default everywhere: a site
 * inherits the tenant, and the tenant inherits the deployment. Naming what
 * is inherited is the point — an admin has to be able to see what a blank
 * field will actually produce.
 */
import { useMemo } from 'react';

/** Every zone the runtime knows, canonical names only. */
function supportedZones(): string[] {
  try {
    const zones = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    if (Array.isArray(zones) && zones.length > 0) return zones;
  } catch {
    // Fall through to the short list below.
  }
  // Only reached on a runtime without `supportedValuesOf`. Enough to keep
  // the control usable rather than empty.
  return [
    'Europe/London',
    'Europe/Dublin',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Madrid',
    'Europe/Rome',
    'Europe/Warsaw',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Tokyo',
    'Australia/Sydney',
    'UTC',
  ];
}

export function TimezoneSelect({
  id,
  value,
  onChange,
  disabled = false,
  /** What a blank selection resolves to, named so the admin can see it. */
  inheritLabel,
  ariaLabel,
}: {
  id?: string;
  value: string | null;
  onChange: (next: string) => void;
  disabled?: boolean;
  inheritLabel: string;
  ariaLabel?: string;
}) {
  const zones = useMemo(supportedZones, []);
  return (
    <select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
      className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
    >
      <option value="">{inheritLabel}</option>
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}
