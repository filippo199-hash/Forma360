'use client';

/**
 * The inputs for an asset type's custom fields, and the read-only view of
 * their values.
 *
 * Extracted because the create page had the only copy: the asset detail
 * page rendered custom fields **nowhere at all**, so a value typed at
 * creation was never visible again and could never be corrected — and
 * changing an asset's type to one that defines fields left no way to fill
 * them in. Two surfaces, one definition, so they cannot drift apart again.
 */
import type { AssetCustomFieldDef } from '@forma360/db/schema';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

export type CustomFieldValues = Record<string, string>;

/**
 * Read the `customFields` blob off a type row. It is `jsonb`, so it
 * arrives as `unknown` and a malformed row must not crash the page.
 */
export function customFieldsOf(
  type: { customFields?: unknown } | null | undefined,
): AssetCustomFieldDef[] {
  return Array.isArray(type?.customFields) ? (type.customFields as AssetCustomFieldDef[]) : [];
}

/** Existing values, tolerating a jsonb blob of any shape. */
export function customFieldValuesOf(asset: { customFieldValues?: unknown }): CustomFieldValues {
  const raw = asset.customFieldValues;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: CustomFieldValues = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/**
 * The first required field with no value, or null. Both surfaces validate
 * through this so "required" means the same thing on create and on edit.
 */
export function firstMissingRequired(
  fields: readonly AssetCustomFieldDef[],
  values: CustomFieldValues,
): AssetCustomFieldDef | null {
  for (const field of fields) {
    if (field.required !== true) continue;
    if ((values[field.id] ?? '').trim().length === 0) return field;
  }
  return null;
}

export function CustomFieldInputs({
  fields,
  values,
  onChange,
  idPrefix = 'cf',
}: {
  fields: readonly AssetCustomFieldDef[];
  values: CustomFieldValues;
  onChange: (fieldId: string, value: string) => void;
  idPrefix?: string;
}) {
  if (fields.length === 0) return null;
  return (
    <>
      {fields.map((field) => (
        <div key={field.id} className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-${field.id}`}>
            {field.name}
            {field.required === true ? <span className="ml-1 text-destructive">*</span> : null}
          </Label>
          {field.fieldType === 'select' ? (
            <select
              id={`${idPrefix}-${field.id}`}
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {(field.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${idPrefix}-${field.id}`}
              type={
                field.fieldType === 'number'
                  ? 'number'
                  : field.fieldType === 'date'
                    ? 'date'
                    : 'text'
              }
              value={values[field.id] ?? ''}
              onChange={(e) => onChange(field.id, e.target.value)}
              placeholder={field.name}
            />
          )}
        </div>
      ))}
    </>
  );
}

/**
 * The values as a definition list, for the detail page's read mode. A
 * field the type defines but the asset has not filled shows an em dash
 * rather than disappearing — "not answered" and "not asked" are different
 * things, and only one of them is a prompt to go and fill it in.
 */
export function CustomFieldReadout({
  fields,
  values,
  emptyLabel,
}: {
  fields: readonly AssetCustomFieldDef[];
  values: CustomFieldValues;
  emptyLabel: string;
}) {
  if (fields.length === 0) return null;
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {fields.map((field) => {
        const value = (values[field.id] ?? '').trim();
        return (
          <div key={field.id}>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {field.name}
            </dt>
            <dd className={value === '' ? 'text-sm text-muted-foreground' : 'text-sm'}>
              {value === '' ? emptyLabel : value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
