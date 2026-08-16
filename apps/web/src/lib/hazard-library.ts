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
  // ── Care-sector starter set ───────────────────────────────────────────────
  // Residential/domiciliary care hazards: the people receiving care are the
  // group most at risk, so these default to 'residents_service_users'.
  {
    id: 'moving-handling-people',
    label: 'Moving and handling of people',
    keywords: ['hoist', 'transfer', 'sling', 'mobility', 'care', 'patient handling'],
    harmDescription:
      'Injury to the person being moved (falls, skin tears, shoulder injury) and musculoskeletal injury to carers from unassisted or badly planned transfers.',
    affectedGroups: ['residents_service_users', 'employees'],
    existingControls: '',
    initial: { likelihood: 4, severity: 4 },
    residual: { likelihood: 2, severity: 3 },
    controls: [
      {
        description: 'Individual moving-and-handling plan agreed and kept current for each person',
        tier: 'administrative',
      },
      {
        description:
          'Hoists, slide sheets and profiling beds provided and maintained; slings matched to the person',
        tier: 'engineering',
      },
      {
        description:
          'People-handling training with competency sign-off; no lifting of body weight by hand',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'scalding-hot-water',
    label: 'Scalding — hot water and hot surfaces',
    keywords: ['scald', 'bath', 'shower', 'tmv', 'hot water', 'radiator', 'burns'],
    harmDescription:
      'Full-thickness scalds from bathing water above 44°C or contact with hot surfaces — residents with reduced mobility or sensation cannot get away.',
    affectedGroups: ['residents_service_users'],
    existingControls: '',
    initial: { likelihood: 3, severity: 5 },
    residual: { likelihood: 1, severity: 4 },
    controls: [
      {
        description: 'Thermostatic mixing valves (TMV3) on baths and showers used by residents',
        tier: 'engineering',
      },
      { description: 'Low-surface-temperature radiators or covers', tier: 'engineering' },
      {
        description: 'Water temperature checked and recorded before every assisted bath',
        tier: 'administrative',
      },
      {
        description: 'TMV service and fail-safe checks on a planned schedule',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'medication-errors',
    label: 'Medication handling and administration errors',
    keywords: ['medication', 'medicines', 'mar', 'dosage', 'drugs', 'administration'],
    harmDescription:
      'Harm from missed, duplicated or wrong-dose medication; unauthorised access to controlled drugs.',
    affectedGroups: ['residents_service_users'],
    existingControls: '',
    initial: { likelihood: 3, severity: 4 },
    residual: { likelihood: 2, severity: 3 },
    controls: [
      {
        description:
          'Medication administration records (MAR) completed at the point of administration',
        tier: 'administrative',
      },
      {
        description: 'Locked storage with controlled-drug register and double signature',
        tier: 'engineering',
      },
      {
        description:
          'Medication competency training with periodic reassessment; errors reported and reviewed without blame',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'bed-rails-falls-from-bed',
    label: 'Falls from bed and bed-rail entrapment',
    keywords: ['bed rails', 'falls', 'entrapment', 'crash mat', 'profiling bed'],
    harmDescription:
      'Fractures and head injury from falls out of bed; asphyxiation from entrapment in gaps around poorly fitted bed rails.',
    affectedGroups: ['residents_service_users'],
    existingControls: '',
    initial: { likelihood: 3, severity: 5 },
    residual: { likelihood: 2, severity: 3 },
    controls: [
      {
        description:
          'Individual bed-rail risk assessment before rails are fitted; consider low beds and crash mats first',
        tier: 'substitute',
      },
      {
        description:
          'Rails compatible with bed and mattress; entrapment-gap checks after every adjustment',
        tier: 'engineering',
      },
      {
        description: 'Falls care plan with sensor mats / regular checks for residents at risk',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'challenging-behaviour',
    label: 'Violence and behaviour that challenges',
    keywords: ['aggression', 'violence', 'behaviour', 'dementia', 'assault', 'distress'],
    harmDescription:
      'Injury to staff and other residents from physical aggression; psychological harm; injury to the distressed person during incidents.',
    affectedGroups: ['employees', 'residents_service_users', 'visitors'],
    existingControls: '',
    initial: { likelihood: 4, severity: 3 },
    residual: { likelihood: 2, severity: 3 },
    controls: [
      {
        description:
          'Individual positive-behaviour support plan identifying triggers and de-escalation steps',
        tier: 'administrative',
      },
      {
        description:
          'De-escalation and breakaway training; restraint only by trained staff as last resort',
        tier: 'administrative',
      },
      {
        description:
          'Staffing levels and environment adjusted to known triggers; incidents reported and plans reviewed',
        tier: 'administrative',
      },
    ],
  },
  {
    id: 'infection-outbreak',
    label: 'Infection outbreak (IPC)',
    keywords: ['infection', 'outbreak', 'ipc', 'norovirus', 'flu', 'hygiene', 'ppe'],
    harmDescription:
      'Rapid spread of infection among residents with reduced immunity — severe illness and death in outbreak conditions; staff absence collapsing safe staffing.',
    affectedGroups: ['residents_service_users', 'employees', 'visitors'],
    existingControls: '',
    initial: { likelihood: 4, severity: 4 },
    residual: { likelihood: 2, severity: 3 },
    controls: [
      {
        description: 'Infection prevention and control policy with a named IPC lead',
        tier: 'administrative',
      },
      {
        description: 'Hand-hygiene stations, cleaning schedules and laundry segregation',
        tier: 'engineering',
      },
      {
        description:
          'Outbreak plan: isolation/cohorting, visitor restrictions and notification to the health protection team',
        tier: 'administrative',
      },
      {
        description: 'Gloves, aprons and fluid-resistant masks per the IPC policy',
        tier: 'ppe',
      },
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
