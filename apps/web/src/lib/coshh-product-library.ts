/**
 * Curated product library for the COSHH "add substance" form (FreeHS B2).
 *
 * Selecting an entry pre-fills the product block — name, supplier,
 * physical form, what it's used for, and (when empty) the storage class —
 * so the person logging a delivery confirms instead of typing from
 * scratch. Hazard data still comes from the SDS: the library is an
 * identity shortcut, not a substitute for reading the sheet.
 *
 * English-only by design, like the hazard library: this is domain
 * reference data, and the i18n catalogue keeps UI chrome separate.
 * Suppliers reflect the common UK brand owner; every value stays
 * editable.
 */
import type { PhysicalForm, StorageClass } from '@forma360/shared/coshh';

export interface CoshhProductTemplate {
  id: string;
  name: string;
  supplier: string;
  keywords: ReadonlyArray<string>;
  physicalForm: PhysicalForm;
  usage: string;
  storageClass?: StorageClass;
}

export const COSHH_PRODUCT_LIBRARY: ReadonlyArray<CoshhProductTemplate> = [
  {
    id: 'wd40',
    name: 'WD-40 Multi-Use Product',
    supplier: 'WD-40 Company',
    keywords: ['lubricant', 'penetrating', 'spray', 'oil'],
    physicalForm: 'aerosol',
    usage: 'Loosening seized fixings and light lubrication',
    storageClass: 'flammable',
  },
  {
    id: 'thick-bleach',
    name: 'Domestos Thick Bleach',
    supplier: 'Unilever',
    keywords: ['bleach', 'sodium hypochlorite', 'toilet', 'sanitiser'],
    physicalForm: 'liquid',
    usage: 'Sanitising toilets, drains and washroom surfaces',
    storageClass: 'corrosive_base',
  },
  {
    id: 'cillit-bang',
    name: 'Cillit Bang Power Cleaner',
    supplier: 'Reckitt',
    keywords: ['limescale', 'descaler', 'bathroom', 'cleaner'],
    physicalForm: 'liquid',
    usage: 'Descaling and heavy-duty surface cleaning',
    storageClass: 'corrosive_acid',
  },
  {
    id: 'flash-multi',
    name: 'Flash Multi-Surface Cleaner',
    supplier: 'Procter & Gamble',
    keywords: ['detergent', 'floor', 'surface', 'cleaner'],
    physicalForm: 'liquid',
    usage: 'General floor and surface cleaning',
    storageClass: 'general',
  },
  {
    id: 'cif-cream',
    name: 'Cif Cream Cleaner',
    supplier: 'Unilever',
    keywords: ['abrasive', 'cream', 'kitchen', 'cleaner'],
    physicalForm: 'liquid',
    usage: 'Abrasive cleaning of sinks, tiles and worktops',
    storageClass: 'general',
  },
  {
    id: 'mr-muscle-oven',
    name: 'Mr Muscle Oven Cleaner',
    supplier: 'SC Johnson',
    keywords: ['oven', 'grill', 'caustic', 'degreaser'],
    physicalForm: 'aerosol',
    usage: 'Removing baked-on grease from ovens and grills',
    storageClass: 'corrosive_base',
  },
  {
    id: 'acetone',
    name: 'Acetone',
    supplier: 'ReAgent Chemicals',
    keywords: ['solvent', 'degreaser', 'resin', 'nail'],
    physicalForm: 'liquid',
    usage: 'Degreasing surfaces and cleaning uncured resins',
    storageClass: 'flammable',
  },
  {
    id: 'ipa',
    name: 'Isopropyl Alcohol 99.9% (IPA)',
    supplier: 'ReAgent Chemicals',
    keywords: ['isopropanol', 'solvent', 'electronics', 'surface prep'],
    physicalForm: 'liquid',
    usage: 'Surface preparation and cleaning electronics',
    storageClass: 'flammable',
  },
  {
    id: 'white-spirit',
    name: 'White Spirit',
    supplier: 'Bartoline',
    keywords: ['solvent', 'paint', 'thinner', 'brush'],
    physicalForm: 'liquid',
    usage: 'Thinning solvent-based paint and cleaning brushes',
    storageClass: 'flammable',
  },
  {
    id: 'meths',
    name: 'Methylated Spirits',
    supplier: 'Bartoline',
    keywords: ['ethanol', 'solvent', 'shellac', 'burner'],
    physicalForm: 'liquid',
    usage: 'Cleaning glass, thinning shellac and fuelling burners',
    storageClass: 'flammable',
  },
  {
    id: 'no-more-nails',
    name: 'UniBond No More Nails',
    supplier: 'Henkel',
    keywords: ['grab adhesive', 'glue', 'bonding'],
    physicalForm: 'other',
    usage: 'Grab-adhesive bonding of battens, skirting and panels',
    storageClass: 'general',
  },
  {
    id: 'evo-stik-contact',
    name: 'Evo-Stik Impact Contact Adhesive',
    supplier: 'Bostik',
    keywords: ['contact adhesive', 'glue', 'laminate', 'rubber'],
    physicalForm: 'liquid',
    usage: 'Bonding laminates, rubber and rigid sheet materials',
    storageClass: 'flammable',
  },
  {
    id: 'sikaflex',
    name: 'Sikaflex EBT+ Sealant',
    supplier: 'Sika',
    keywords: ['sealant', 'polyurethane', 'joint', 'bond'],
    physicalForm: 'other',
    usage: 'Sealing and bonding movement joints',
    storageClass: 'general',
  },
  {
    id: 'expanding-foam',
    name: 'Soudal Expanding PU Foam',
    supplier: 'Soudal',
    keywords: ['polyurethane', 'foam', 'gap filler', 'isocyanate'],
    physicalForm: 'aerosol',
    usage: 'Filling gaps around frames and service penetrations',
    storageClass: 'flammable',
  },
  {
    id: 'cement',
    name: 'Portland Cement',
    supplier: 'Hanson',
    keywords: ['concrete', 'mortar', 'screed', 'chromium'],
    physicalForm: 'powder',
    usage: 'Mixing concrete, mortar and screed',
    storageClass: 'general',
  },
  {
    id: 'multi-finish',
    name: 'Thistle Multi-Finish Plaster',
    supplier: 'British Gypsum',
    keywords: ['plaster', 'skim', 'gypsum'],
    physicalForm: 'powder',
    usage: 'Skimming internal walls and ceilings',
    storageClass: 'general',
  },
  {
    id: 'brick-cleaner',
    name: 'Everbuild Brick & Patio Cleaner',
    supplier: 'Everbuild',
    keywords: ['hydrochloric', 'acid', 'mortar', 'masonry'],
    physicalForm: 'liquid',
    usage: 'Removing mortar and cement stains from masonry',
    storageClass: 'corrosive_acid',
  },
  {
    id: 'caustic-soda',
    name: 'Caustic Soda (Sodium Hydroxide)',
    supplier: 'Dri-Pak',
    keywords: ['sodium hydroxide', 'drain', 'alkali'],
    physicalForm: 'solid',
    usage: 'Clearing blocked drains and heavy degreasing',
    storageClass: 'corrosive_base',
  },
  {
    id: 'line-marker',
    name: 'Rocol Line Marking Paint',
    supplier: 'Rocol',
    keywords: ['paint', 'marking', 'floor', 'pitch'],
    physicalForm: 'aerosol',
    usage: 'Marking out floors, car parks and pitches',
    storageClass: 'flammable',
  },
  {
    id: 'diesel',
    name: 'Diesel (Gas Oil)',
    supplier: 'Shell',
    keywords: ['fuel', 'derv', 'plant', 'generator'],
    physicalForm: 'liquid',
    usage: 'Fuelling plant, generators and site vehicles',
    storageClass: 'flammable',
  },
  {
    id: 'petrol',
    name: 'Unleaded Petrol',
    supplier: 'Shell',
    keywords: ['fuel', 'gasoline', 'strimmer', 'mower'],
    physicalForm: 'liquid',
    usage: 'Fuelling small plant and grounds equipment',
    storageClass: 'flammable',
  },
  {
    id: 'propane',
    name: 'Propane (LPG Cylinder)',
    supplier: 'Calor',
    keywords: ['lpg', 'gas', 'torch', 'heater'],
    physicalForm: 'gas',
    usage: 'Space heating, torching and bitumen work',
    storageClass: 'compressed_gas',
  },
  {
    id: 'oxygen',
    name: 'Oxygen (Compressed)',
    supplier: 'BOC',
    keywords: ['gas', 'welding', 'cutting', 'oxy'],
    physicalForm: 'gas',
    usage: 'Oxy-fuel welding and cutting',
    storageClass: 'compressed_gas',
  },
  {
    id: 'acetylene',
    name: 'Acetylene (Dissolved)',
    supplier: 'BOC',
    keywords: ['gas', 'welding', 'cutting', 'oxy'],
    physicalForm: 'gas',
    usage: 'Oxy-fuel welding and cutting',
    storageClass: 'compressed_gas',
  },
  {
    id: 'epoxy-resin',
    name: 'Sikadur Two-Pack Epoxy Resin',
    supplier: 'Sika',
    keywords: ['epoxy', 'resin', 'hardener', 'sensitiser'],
    physicalForm: 'liquid',
    usage: 'Structural bonding and concrete repairs',
    storageClass: 'general',
  },
  {
    id: 'screenwash',
    name: 'CarPlan Screenwash Concentrate',
    supplier: 'CarPlan',
    keywords: ['ethanol', 'vehicle', 'windscreen'],
    physicalForm: 'liquid',
    usage: 'Topping up vehicle screenwash',
    storageClass: 'general',
  },
];

/** Case-insensitive search over names, suppliers + keywords. Empty query = top picks. */
export function searchCoshhProductLibrary(query: string, limit = 8): CoshhProductTemplate[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return COSHH_PRODUCT_LIBRARY.slice(0, limit);
  return COSHH_PRODUCT_LIBRARY.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.supplier.toLowerCase().includes(q) ||
      p.keywords.some((k) => k.includes(q)),
  ).slice(0, limit);
}
