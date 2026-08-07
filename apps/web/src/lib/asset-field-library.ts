/**
 * Suggested custom fields for a new asset category (FreeHS assets).
 *
 * When someone types "Cars" we already know, roughly, what an asset
 * register needs to hold about a car: registration, MOT, service due,
 * mileage. Making them invent that list from an empty form is the part
 * people get wrong — categories end up with two fields and the register
 * cannot answer the questions it exists for.
 *
 * So this is a starting point, never an imposition: the suggestions
 * arrive as **unticked-until-reviewed checkboxes**, every one is
 * editable afterwards, and declining the lot is one click.
 *
 * Curated first, AI second. A curated hit is instant, free, deterministic
 * and testable, and it covers the categories a safety register actually
 * contains. Anything the library does not know falls through to Claude
 * (`/api/ai/asset-field-suggest`), which is the same
 * suggest-then-confirm shape COSHH control recommendations use.
 *
 * English-only by design, like `hazard-library.ts`: this is domain
 * reference data, and the i18n catalogue keeps UI chrome separate.
 */

export type SuggestedFieldType = 'text' | 'number' | 'date' | 'select';

export interface SuggestedField {
  /** Stable within a suggestion set; the caller mints the real id. */
  key: string;
  name: string;
  fieldType: SuggestedFieldType;
  options?: ReadonlyArray<string>;
  /** Pre-ticked for the fields most registers genuinely need. */
  recommended: boolean;
  /** Why it is being suggested — shown under the checkbox. */
  hint: string;
}

export interface AssetCategoryTemplate {
  id: string;
  label: string;
  /** Lowercase substrings that select this template. */
  keywords: ReadonlyArray<string>;
  fields: ReadonlyArray<SuggestedField>;
}

/** Fields almost every serviceable asset wants. Merged into most templates. */
const SERVICE_FIELDS: ReadonlyArray<SuggestedField> = [
  {
    key: 'serial',
    name: 'Serial number',
    fieldType: 'text',
    recommended: true,
    hint: 'Identifies the individual unit on service records and recalls.',
  },
  {
    key: 'manufacturer',
    name: 'Manufacturer',
    fieldType: 'text',
    recommended: false,
    hint: 'Useful when sourcing parts or checking a safety notice.',
  },
  {
    key: 'next-service',
    name: 'Next service due',
    fieldType: 'date',
    recommended: true,
    hint: 'Drives the maintenance view and the overdue list.',
  },
];

export const ASSET_CATEGORY_LIBRARY: ReadonlyArray<AssetCategoryTemplate> = [
  {
    id: 'vehicle',
    label: 'Vehicles',
    keywords: ['car', 'cars', 'van', 'vans', 'vehicle', 'fleet', 'lorry', 'truck', 'hgv', 'lgv'],
    fields: [
      {
        key: 'registration',
        name: 'Registration',
        fieldType: 'text',
        recommended: true,
        hint: 'The number plate — how everyone actually refers to the vehicle.',
      },
      {
        key: 'mot-due',
        name: 'MOT due',
        fieldType: 'date',
        recommended: true,
        hint: 'Driving without a valid MOT is an offence; this is the date you chase.',
      },
      {
        key: 'tax-due',
        name: 'Road tax due',
        fieldType: 'date',
        recommended: false,
        hint: 'Renewal date, if you manage tax centrally.',
      },
      {
        key: 'insurance-due',
        name: 'Insurance renewal',
        fieldType: 'date',
        recommended: false,
        hint: 'Fleet policy renewal for this vehicle.',
      },
      {
        key: 'mileage',
        name: 'Mileage',
        fieldType: 'number',
        recommended: false,
        hint: 'Service intervals are usually mileage-based as well as time-based.',
      },
      {
        key: 'fuel',
        name: 'Fuel type',
        fieldType: 'select',
        options: ['Petrol', 'Diesel', 'Hybrid', 'Electric'],
        recommended: false,
        hint: 'Drives fuel reporting and workshop requirements.',
      },
      ...SERVICE_FIELDS.filter((f) => f.key !== 'serial'),
    ],
  },
  {
    id: 'lifting',
    label: 'Lifting equipment',
    keywords: [
      'lift',
      'lifting',
      'crane',
      'hoist',
      'sling',
      'chain',
      'shackle',
      'strop',
      'jack',
      'telehandler',
    ],
    fields: [
      {
        key: 'swl',
        name: 'Safe working load (kg)',
        fieldType: 'number',
        recommended: true,
        hint: 'The rated capacity — the single most important number on the asset.',
      },
      {
        key: 'loler-due',
        name: 'LOLER examination due',
        fieldType: 'date',
        recommended: true,
        hint: 'Thorough examination: 6 months for lifting people, 12 otherwise.',
      },
      {
        key: 'loler-cert',
        name: 'Examination certificate number',
        fieldType: 'text',
        recommended: false,
        hint: 'The report of thorough examination this asset was last cleared on.',
      },
      ...SERVICE_FIELDS,
    ],
  },
  {
    id: 'access',
    label: 'Access equipment',
    keywords: ['ladder', 'ladders', 'step', 'tower', 'scaffold', 'podium', 'mewp', 'cherry'],
    fields: [
      {
        key: 'class',
        name: 'Duty rating',
        fieldType: 'select',
        options: ['Class 1 — Industrial', 'EN 131 — Trade', 'Class 3 — Domestic'],
        recommended: true,
        hint: 'Domestic-rated equipment on a work site is a common finding.',
      },
      {
        key: 'height',
        name: 'Working height (m)',
        fieldType: 'number',
        recommended: false,
        hint: 'Used when matching equipment to a task.',
      },
      {
        key: 'inspection-due',
        name: 'Formal inspection due',
        fieldType: 'date',
        recommended: true,
        hint: 'Access equipment needs periodic recorded inspection.',
      },
      ...SERVICE_FIELDS.filter((f) => f.key !== 'next-service'),
    ],
  },
  {
    id: 'electrical',
    label: 'Electrical equipment',
    keywords: ['electric', 'electrical', 'pat', 'appliance', 'power tool', 'tool', 'tools'],
    fields: [
      {
        key: 'pat-due',
        name: 'PAT test due',
        fieldType: 'date',
        recommended: true,
        hint: 'Portable appliance testing interval for this item.',
      },
      {
        key: 'voltage',
        name: 'Voltage',
        fieldType: 'select',
        options: ['110V', '230V', '400V', 'Battery'],
        recommended: false,
        hint: '110V is the site standard for portable tools in the UK.',
      },
      ...SERVICE_FIELDS,
    ],
  },
  {
    id: 'fire',
    label: 'Fire equipment',
    keywords: ['fire', 'extinguisher', 'alarm', 'sprinkler', 'hydrant', 'blanket'],
    fields: [
      {
        key: 'extinguisher-type',
        name: 'Type',
        fieldType: 'select',
        options: ['Water', 'Foam', 'CO2', 'Dry powder', 'Wet chemical'],
        recommended: true,
        hint: 'The wrong type on the wrong fire is the classic finding.',
      },
      {
        key: 'service-due',
        name: 'Annual service due',
        fieldType: 'date',
        recommended: true,
        hint: 'BS 5306 annual service by a competent person.',
      },
      {
        key: 'location',
        name: 'Location on site',
        fieldType: 'text',
        recommended: false,
        hint: 'Where the unit is mounted, for the fire logbook walk round.',
      },
      ...SERVICE_FIELDS.filter((f) => f.key !== 'next-service'),
    ],
  },
  {
    id: 'plant',
    label: 'Plant and machinery',
    keywords: [
      'plant',
      'machine',
      'machinery',
      'excavator',
      'digger',
      'forklift',
      'flt',
      'press',
      'dumper',
      'compressor',
    ],
    fields: [
      {
        key: 'thorough-exam',
        name: 'Thorough examination due',
        fieldType: 'date',
        recommended: true,
        hint: 'PUWER / LOLER examination date for the machine.',
      },
      {
        key: 'hours',
        name: 'Running hours',
        fieldType: 'number',
        recommended: false,
        hint: 'Service intervals on plant are usually hours, not dates.',
      },
      {
        key: 'operator-ticket',
        name: 'Operator ticket required',
        fieldType: 'text',
        recommended: false,
        hint: 'Which training a driver must hold — links to the training matrix.',
      },
      ...SERVICE_FIELDS,
    ],
  },
  {
    id: 'ppe',
    label: 'PPE and RPE',
    keywords: ['ppe', 'rpe', 'harness', 'mask', 'respirator', 'helmet', 'lanyard'],
    fields: [
      {
        key: 'size',
        name: 'Size',
        fieldType: 'text',
        recommended: false,
        hint: 'Fit matters — especially for RPE face fit.',
      },
      {
        key: 'issued-to',
        name: 'Issued to',
        fieldType: 'text',
        recommended: true,
        hint: 'Personal issue equipment should be traceable to a person.',
      },
      {
        key: 'expiry',
        name: 'Expiry date',
        fieldType: 'date',
        recommended: true,
        hint: 'Harnesses and helmets have a manufacturer lifespan.',
      },
      {
        key: 'inspection-due',
        name: 'Inspection due',
        fieldType: 'date',
        recommended: true,
        hint: 'Fall-arrest equipment needs recorded periodic inspection.',
      },
    ],
  },
  {
    id: 'it',
    label: 'IT equipment',
    keywords: ['it', 'laptop', 'computer', 'phone', 'tablet', 'monitor', 'printer'],
    fields: [
      {
        key: 'asset-tag',
        name: 'Asset tag',
        fieldType: 'text',
        recommended: true,
        hint: 'Your own inventory label.',
      },
      {
        key: 'assigned-to',
        name: 'Assigned to',
        fieldType: 'text',
        recommended: true,
        hint: 'Who is currently holding it.',
      },
      {
        key: 'warranty-end',
        name: 'Warranty expires',
        fieldType: 'date',
        recommended: false,
        hint: 'Worth knowing before paying for a repair.',
      },
      ...SERVICE_FIELDS.filter((f) => f.key === 'serial'),
    ],
  },
  {
    id: 'building',
    label: 'Buildings and fixed plant',
    keywords: ['building', 'premises', 'boiler', 'hvac', 'lift shaft', 'plantroom', 'roof'],
    fields: [
      {
        key: 'inspection-due',
        name: 'Statutory inspection due',
        fieldType: 'date',
        recommended: true,
        hint: 'Pressure systems, lifts and HVAC all carry statutory intervals.',
      },
      {
        key: 'contractor',
        name: 'Servicing contractor',
        fieldType: 'text',
        recommended: false,
        hint: 'Who holds the maintenance contract.',
      },
      ...SERVICE_FIELDS.filter((f) => f.key !== 'serial'),
    ],
  },
];

/**
 * The template a typed category name matches, or null.
 *
 * Matches on whole words so "Cargo" does not become "car", while still
 * catching plurals and compounds people actually type ("Site vehicles",
 * "Fork lift trucks").
 */
export function matchAssetCategory(name: string): AssetCategoryTemplate | null {
  const q = name.trim().toLowerCase();
  if (q.length < 2) return null;
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  if (words.length === 0) return null;
  // People write compounds either way — "fork lift" and "forklift" are the
  // same thing, and a forklift is thorough-examination plant rather than an
  // MOT-and-road-tax vehicle, so getting this wrong proposes the wrong
  // regime entirely.
  const squashed = words.join('');

  let best: { template: AssetCategoryTemplate; score: number } | null = null;
  for (const template of ASSET_CATEGORY_LIBRARY) {
    let score = 0;
    for (const keyword of template.keywords) {
      // Score by SPECIFICITY, not by hit count. "Fork lift trucks" matches
      // `lift` (lifting), `truck` (vehicle) and `forklift` (plant); scoring
      // each hit equally left a three-way tie that array order broke, and
      // array order proposed MOT and road tax for a forklift. The longest
      // matching keyword is the most specific, so it wins.
      if (words.includes(keyword)) score = Math.max(score, keyword.length);
      // A compound spelled with a space is still a whole match.
      else if (keyword.length >= 5 && squashed.includes(keyword)) {
        score = Math.max(score, keyword.length);
      }
      // A keyword inside a longer word is weaker but real
      // ("firefighting equipment" → fire).
      else if (q.includes(keyword) && keyword.length >= 4) score = Math.max(score, 1);
    }
    if (score > 0 && (best === null || score > best.score)) best = { template, score };
  }
  return best?.template ?? null;
}

/** Suggestions for a typed name, or an empty list when nothing matches. */
export function suggestFieldsFor(name: string): SuggestedField[] {
  const template = matchAssetCategory(name);
  if (template === null) return [];
  // De-duplicate by key: templates spread shared field sets, and a
  // duplicate key would collide when the caller mints ids.
  const seen = new Set<string>();
  const out: SuggestedField[] = [];
  for (const field of template.fields) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
  }
  return out;
}
