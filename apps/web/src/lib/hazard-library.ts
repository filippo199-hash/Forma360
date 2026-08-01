/**
 * Curated hazard library for the Risk Assessments quick-add (FreeHS B1).
 *
 * Selecting an entry pre-fills the whole hazard card — harm description,
 * affected groups, typical controls with their hierarchy-of-control tiers,
 * and indicative initial/residual scores — so the assessor confirms and
 * tailors instead of typing from scratch. Content is a practitioner
 * starting point, not legal advice; every value stays editable.
 *
 * English-only by design, like the public-site copy modules: this is
 * domain reference data, and the i18n catalogue keeps UI chrome separate.
 * Suggested controls are inserted as "in place" — the assessor flips the
 * missing ones to "planned" (which generates CAPA actions at publish).
 */

export type LibraryTier = 'eliminate' | 'substitute' | 'engineering' | 'administrative' | 'ppe';

export interface HazardTemplate {
  id: string;
  label: string;
  keywords: ReadonlyArray<string>;
  harmDescription: string;
  affectedGroups: ReadonlyArray<string>;
  existingControls: string;
  initial: { likelihood: number; severity: number };
  residual: { likelihood: number; severity: number };
  controls: ReadonlyArray<{ description: string; tier: LibraryTier }>;
}

export const HAZARD_LIBRARY: ReadonlyArray<HazardTemplate> = [
  {
    id: 'manual-handling',
    label: 'Manual handling of loads',
    keywords: ['lifting', 'carrying', 'back', 'loads', 'pushing', 'pulling'],
    harmDescription:
      'Musculoskeletal injury — back strain, hernia, crush injuries to hands and feet from dropped loads.',
    affectedGroups: ['employees', 'contractors'],
    existingControls: '',
    initial: { likelihood: 4, severity: 3 },
    residual: { likelihood: 2, severity: 3 },
    controls: [
      { description: 'Eliminate the lift — deliver direct to point of use', tier: 'eliminate' },
      {
        description: 'Provide mechanical aids (trolleys, pallet trucks, hoists)',
        tier: 'engineering',
      },
      {
        description: 'Manual handling training and team-lift procedure for heavy items',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'slips-trips',
    label: 'Slips, trips and falls on the level',
    keywords: ['floor', 'wet', 'spill', 'housekeeping', 'trailing cables', 'ice'],
    harmDescription: 'Fractures, sprains and head injuries from falls on wet or obstructed floors.',
    affectedGroups: ['employees', 'cleaners', 'visitors', 'members_of_public'],
    existingControls: '',
    initial: { likelihood: 4, severity: 3 },
    residual: { likelihood: 2, severity: 2 },
    controls: [
      { description: 'Fix leaks and damaged flooring at source', tier: 'eliminate' },
      { description: 'Anti-slip flooring / matting in wet areas', tier: 'engineering' },
      {
        description: 'Clean-as-you-go policy, spill kits and wet-floor signage',
        tier: 'administrative',
      },
      { description: 'Slip-resistant footwear where floors cannot stay dry', tier: 'ppe' },
    ],
  },
  {
    id: 'work-at-height',
    label: 'Working at height',
    keywords: ['ladder', 'roof', 'scaffold', 'fall', 'mewp', 'platform'],
    harmDescription:
      'Fatal or major injury from a fall; injury to people below from falling objects.',
    affectedGroups: ['employees', 'contractors'],
    existingControls: '',
    initial: { likelihood: 3, severity: 5 },
    residual: { likelihood: 2, severity: 4 },
    controls: [
      {
        description: 'Avoid work at height — do the task from ground level where possible',
        tier: 'eliminate',
      },
      {
        description: 'Use MEWPs or fixed scaffolds with guardrails instead of ladders',
        tier: 'engineering',
      },
      {
        description: 'Permit-to-work, pre-use inspections and exclusion zones below',
        tier: 'administrative',
      },
      {
        description: 'Harness with suitable anchor where collective protection is impracticable',
        tier: 'ppe',
      },
    ],
  },
  {
    id: 'electricity',
    label: 'Electricity — fixed installation and portable appliances',
    keywords: ['shock', 'electrical', 'wiring', 'pat', 'cables'],
    harmDescription:
      'Electric shock, burns, fire from damaged equipment or unsafe systems of work.',
    affectedGroups: ['employees', 'contractors', 'cleaners'],
    existingControls: '',
    initial: { likelihood: 3, severity: 5 },
    residual: { likelihood: 2, severity: 4 },
    controls: [
      { description: 'RCD protection on socket circuits', tier: 'engineering' },
      {
        description: 'Fixed-wire testing and portable appliance inspection programme',
        tier: 'administrative',
      },
      {
        description: 'Lock-off / isolation procedure before work on systems',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'fire',
    label: 'Fire',
    keywords: ['evacuation', 'flammable', 'alarm', 'smoke', 'ignition'],
    harmDescription: 'Burns, smoke inhalation, fatalities; loss of premises.',
    affectedGroups: ['employees', 'contractors', 'visitors', 'members_of_public'],
    existingControls: '',
    initial: { likelihood: 3, severity: 5 },
    residual: { likelihood: 2, severity: 4 },
    controls: [
      { description: 'Control ignition sources and reduce flammable storage', tier: 'substitute' },
      {
        description: 'Fire detection, alarm and emergency lighting maintained',
        tier: 'engineering',
      },
      {
        description: 'Evacuation drills, fire marshals and extinguisher training',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'coshh',
    label: 'Hazardous substances (COSHH)',
    keywords: ['chemicals', 'cleaning', 'dust', 'fumes', 'solvent', 'coshh'],
    harmDescription:
      'Dermatitis, respiratory sensitisation, chemical burns, long-term ill health from exposure.',
    affectedGroups: ['employees', 'cleaners', 'contractors', 'new_expectant_mothers'],
    existingControls: '',
    initial: { likelihood: 3, severity: 4 },
    residual: { likelihood: 2, severity: 3 },
    controls: [
      { description: 'Substitute for a less hazardous product', tier: 'substitute' },
      { description: 'Local exhaust ventilation / use in ventilated areas', tier: 'engineering' },
      {
        description: 'COSHH assessments, safety data sheets and exposure monitoring',
        tier: 'administrative',
      },
      { description: 'Gloves and eye protection per the safety data sheet', tier: 'ppe' },
    ],
  },
  {
    id: 'machinery',
    label: 'Machinery and work equipment',
    keywords: ['guarding', 'entanglement', 'moving parts', 'puwer', 'maintenance'],
    harmDescription: 'Entanglement, crushing, amputation at dangerous moving parts.',
    affectedGroups: ['employees', 'young_persons'],
    existingControls: '',
    initial: { likelihood: 3, severity: 5 },
    residual: { likelihood: 2, severity: 4 },
    controls: [
      { description: 'Fixed and interlocked guarding on dangerous parts', tier: 'engineering' },
      { description: 'Isolation / lock-off for maintenance and cleaning', tier: 'administrative' },
      { description: 'Restrict young or untrained persons from operating', tier: 'administrative' },
    ],
  },
  {
    id: 'workplace-transport',
    label: 'Workplace transport and vehicle movements',
    keywords: ['forklift', 'vehicles', 'reversing', 'pedestrians', 'yard', 'deliveries'],
    harmDescription: 'Pedestrians struck by vehicles; crush injuries during reversing and loading.',
    affectedGroups: ['employees', 'contractors', 'visitors'],
    existingControls: '',
    initial: { likelihood: 3, severity: 5 },
    residual: { likelihood: 2, severity: 4 },
    controls: [
      { description: 'Physical segregation of pedestrians and vehicles', tier: 'engineering' },
      {
        description: 'One-way system, speed limits and banksman for reversing',
        tier: 'administrative',
      },
      { description: 'High-visibility clothing in vehicle areas', tier: 'ppe' },
    ],
  },
  {
    id: 'noise',
    label: 'Noise',
    keywords: ['hearing', 'decibel', 'loud', 'tinnitus'],
    harmDescription: 'Noise-induced hearing loss and tinnitus from sustained or peak exposure.',
    affectedGroups: ['employees', 'contractors'],
    existingControls: '',
    initial: { likelihood: 3, severity: 3 },
    residual: { likelihood: 2, severity: 2 },
    controls: [
      { description: 'Quieter equipment or damping / enclosures at source', tier: 'engineering' },
      {
        description: 'Noise assessment, exposure rotation and hearing surveillance',
        tier: 'administrative',
      },
      { description: 'Hearing protection in mandatory zones', tier: 'ppe' },
    ],
  },
  {
    id: 'vibration',
    label: 'Hand-arm vibration (HAVS)',
    keywords: ['vibration', 'power tools', 'havs', 'white finger'],
    harmDescription: 'Hand-arm vibration syndrome and carpal tunnel from powered hand tools.',
    affectedGroups: ['employees'],
    existingControls: '',
    initial: { likelihood: 3, severity: 3 },
    residual: { likelihood: 2, severity: 2 },
    controls: [
      {
        description: 'Low-vibration tools; do the work mechanically where possible',
        tier: 'substitute',
      },
      { description: 'Trigger-time limits and job rotation', tier: 'administrative' },
      { description: 'Health surveillance for exposed workers', tier: 'administrative' },
    ],
  },
  {
    id: 'dse',
    label: 'Display screen equipment (DSE)',
    keywords: ['workstation', 'screen', 'posture', 'office', 'ergonomic'],
    harmDescription: 'Upper-limb disorders, back pain, eye strain from poor workstation setup.',
    affectedGroups: ['employees'],
    existingControls: '',
    initial: { likelihood: 3, severity: 2 },
    residual: { likelihood: 2, severity: 2 },
    controls: [
      { description: 'DSE workstation assessments for all users', tier: 'administrative' },
      { description: 'Adjustable chairs, screens and laptop risers', tier: 'engineering' },
      { description: 'Regular breaks and eyesight tests on request', tier: 'administrative' },
    ],
  },
  {
    id: 'lone-working',
    label: 'Lone working',
    keywords: ['alone', 'remote', 'out of hours', 'isolation'],
    harmDescription: 'Inability to summon help after accident or ill health; violence risk.',
    affectedGroups: ['lone_workers', 'employees', 'cleaners'],
    existingControls: '',
    initial: { likelihood: 3, severity: 4 },
    residual: { likelihood: 2, severity: 3 },
    controls: [
      { description: 'Avoid lone working for higher-risk tasks', tier: 'eliminate' },
      { description: 'Check-in schedule and lone-worker alarm/app', tier: 'engineering' },
      { description: 'Dynamic risk assessment and escalation procedure', tier: 'administrative' },
    ],
  },
  {
    id: 'stress',
    label: 'Work-related stress',
    keywords: ['mental health', 'workload', 'wellbeing', 'fatigue'],
    harmDescription: 'Anxiety, depression, burnout; increased error and absence rates.',
    affectedGroups: ['employees'],
    existingControls: '',
    initial: { likelihood: 3, severity: 3 },
    residual: { likelihood: 2, severity: 2 },
    controls: [
      {
        description: 'Workload and shift-design review against the HSE Management Standards',
        tier: 'administrative',
      },
      {
        description: 'Trained mental-health first aiders and confidential support route',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'asbestos',
    label: 'Asbestos-containing materials',
    keywords: ['acm', 'refurbishment', 'ceiling', 'insulation', 'survey'],
    harmDescription: 'Mesothelioma, asbestosis and lung cancer from disturbed fibres.',
    affectedGroups: ['employees', 'contractors'],
    existingControls: '',
    initial: { likelihood: 2, severity: 5 },
    residual: { likelihood: 1, severity: 5 },
    controls: [
      {
        description: 'Asbestos register and management survey before any intrusive work',
        tier: 'administrative',
      },
      { description: 'Licensed contractor removal where required', tier: 'administrative' },
      { description: 'Encapsulate and label materials left in place', tier: 'engineering' },
    ],
  },
];

/** Case-insensitive search over labels + keywords. Empty query = top picks. */
export function searchHazardLibrary(query: string, limit = 6): HazardTemplate[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return HAZARD_LIBRARY.slice(0, limit);
  return HAZARD_LIBRARY.filter(
    (h) => h.label.toLowerCase().includes(q) || h.keywords.some((k) => k.includes(q)),
  ).slice(0, limit);
}
