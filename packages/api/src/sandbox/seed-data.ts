/**
 * The content a try-it-now workspace is furnished with (ADR 0017).
 *
 * Deliberately *not* i18n'd: these are seeded database rows — a
 * contractor called Marco Rossi, a hazard about hot work near a
 * sprinkler head — not interface copy. They are the visitor's data from
 * the moment the workspace exists, editable and deletable like anything
 * else they type in. The i18n rule (ground rule 3) governs the chrome
 * around them, which lives in the message bundles.
 *
 * Everything here is written to read like a real Tuesday at a real
 * company. The one rule the content follows: each scenario leaves
 * exactly one decision open for the visitor, because approving a permit
 * someone else half-filled is a judgement, whereas an empty register is
 * a chore.
 */

import type { ControlTier } from '@forma360/db/schema';
import { parseTemplateSpec, type TemplateSpec } from '@forma360/shared/template-spec';
import type { PermitCategory } from '@forma360/shared/permits';

/** Sites every sandbox gets, so location pickers are never empty. */
export const SANDBOX_SITES = [
  { name: 'Eastgate Distribution Centre', ref: 'eastgate' },
  { name: 'Northfield Works', ref: 'northfield' },
] as const;

/** Contractors on site — used by permits, RAMS and the documents register. */
export const SANDBOX_CONTRACTORS = [
  { name: 'Rossi Mechanical Services', ref: 'rossi' },
  { name: 'Halden Electrical Ltd', ref: 'halden' },
] as const;

/** A colleague, so approvals and assignments have someone to point at. */
export const SANDBOX_COLLEAGUE = {
  firstName: 'Priya',
  lastName: 'Shah',
  jobTitle: 'Operations Manager',
} as const;

/**
 * Risk-assessment content per refinement. The last hazard in each list
 * is deliberately left without controls and without a residual rating —
 * that is the visitor's decision, and completing it is what turns a
 * demo into their document.
 */
export interface SeedHazard {
  readonly hazard: string;
  readonly harmDescription: string;
  readonly affectedGroups: readonly string[];
  readonly initialLikelihood: number | null;
  readonly initialSeverity: number | null;
  readonly existingControls: string;
  readonly residualLikelihood: number | null;
  readonly residualSeverity: number | null;
  /** Required when the residual lands in the high band — publish gate. */
  readonly residualJustification?: string;
  readonly controls: ReadonlyArray<{ description: string; tier: ControlTier }>;
}

export interface SeedRiskAssessment {
  readonly title: string;
  readonly activity: string;
  readonly hazards: readonly SeedHazard[];
}

export const SANDBOX_RISK_ASSESSMENTS: Record<string, SeedRiskAssessment> = {
  general: {
    title: 'Warehouse loading bay operations',
    activity:
      'Daily loading and unloading of HGVs at the Eastgate bays, including pedestrian movement across the yard and use of counterbalance forklifts.',
    hazards: [
      {
        hazard: 'Forklift / pedestrian collision in the loading bay',
        harmDescription:
          'Crush or impact injury to a pedestrian struck by a forklift reversing out of a bay. Potentially fatal.',
        affectedGroups: ['Employees', 'Contractors', 'Visitors'],
        initialLikelihood: 4,
        initialSeverity: 5,
        existingControls:
          'Segregated pedestrian walkway painted through the yard; forklift operators hold in-date accredited training.',
        residualLikelihood: 2,
        residualSeverity: 5,
        // 2 x 5 = 10 lands in the HIGH band under the default matrix,
        // and `riskAssessments.publish` refuses a high residual with no
        // planned control and no justification. Without this line the
        // visitor completes the one decision the seed leaves them, hits
        // Publish, and is blocked by a hazard that is not theirs — the
        // tile's entire promise dies at the last step.
        residualJustification:
          'Segregation and reversing alarms cut the frequency of an encounter, but severity stays at 5 because a collision with a counterbalance truck remains potentially fatal. Further reduction is not reasonably practicable at this yard layout.',
        controls: [
          {
            description: 'Physical barrier separating the walkway from the bay apron',
            tier: 'engineering',
          },
          {
            description: 'Reversing alarms and flashing beacons on all yard forklifts',
            tier: 'engineering',
          },
          { description: 'High-visibility vests mandatory beyond the yard door', tier: 'ppe' },
        ],
      },
      {
        hazard: 'Falls from the loading dock edge',
        harmDescription:
          'Fall of approximately 1.2 m from the dock edge to the yard surface — fractures, head injury.',
        affectedGroups: ['Employees', 'Contractors'],
        initialLikelihood: 3,
        initialSeverity: 4,
        existingControls: 'Edge marked with hazard tape; dock levellers inspected annually.',
        residualLikelihood: 2,
        residualSeverity: 3,
        controls: [
          { description: 'Self-closing dock gates fitted to every open bay', tier: 'engineering' },
          { description: 'Toolbox talk on dock-edge working at induction', tier: 'administrative' },
        ],
      },
      {
        hazard: 'Manual handling of palletised goods',
        harmDescription:
          'Musculoskeletal injury from repeated lifting and twisting when breaking down mixed pallets.',
        affectedGroups: ['Employees'],
        initialLikelihood: 4,
        initialSeverity: 3,
        existingControls: '',
        // Left unrated on purpose — this is the visitor's call.
        residualLikelihood: null,
        residualSeverity: null,
        controls: [],
      },
    ],
  },
  manualHandling: {
    title: 'Manual handling — order picking',
    activity:
      'Picking and packing mixed cases from racking at heights between floor level and 1.8 m across a full shift.',
    hazards: [
      {
        hazard: 'Repetitive lifting above shoulder height',
        harmDescription: 'Shoulder and lower-back musculoskeletal disorders developing over time.',
        affectedGroups: ['Employees'],
        initialLikelihood: 4,
        initialSeverity: 3,
        existingControls:
          'Heaviest lines relocated to golden-zone racking between knee and shoulder height.',
        residualLikelihood: 2,
        residualSeverity: 3,
        controls: [
          {
            description: 'Heavy or awkward lines restricted to powered pick trucks',
            tier: 'engineering',
          },
          {
            description: 'Manual handling training refreshed every two years',
            tier: 'administrative',
          },
        ],
      },
      {
        hazard: 'Carrying loads on the pick route',
        harmDescription: 'Trips and strains while carrying cases along congested aisles.',
        affectedGroups: ['Employees', 'Agency staff'],
        initialLikelihood: 3,
        initialSeverity: 3,
        existingControls: '',
        residualLikelihood: null,
        residualSeverity: null,
        controls: [],
      },
    ],
  },
};

/** Permit content per refinement, keyed by the permit-type category. */
export interface SeedPermit {
  /** Permit-type category from `DEFAULT_PERMIT_TYPES`. */
  readonly category: PermitCategory;
  readonly title: string;
  readonly description: string;
  readonly locationText: string;
  readonly contractorRef: string;
}

export const SANDBOX_PERMITS: Record<string, SeedPermit> = {
  hotWork: {
    category: 'hot_work',
    title: 'Welding repair to conveyor frame — Line 3',
    description:
      'MIG welding to repair a cracked support bracket on the Line 3 conveyor frame. Work is within 6 m of a sprinkler head and 4 m of stored cardboard packaging.',
    locationText: 'Northfield Works — Line 3, mezzanine level',
    contractorRef: 'rossi',
  },
  confinedSpace: {
    category: 'confined_space',
    title: 'Effluent tank entry for annual inspection',
    description:
      'Entry into the below-ground effluent tank to inspect the internal lining. Tank isolated and drained; residual sludge present.',
    locationText: 'Northfield Works — effluent compound',
    contractorRef: 'rossi',
  },
  workingAtHeight: {
    category: 'work_at_height',
    title: 'Gutter clearance to warehouse roof',
    description:
      'Clearing blocked box gutters along the north elevation from a MEWP. Fragile rooflights within 2 m of the working position.',
    locationText: 'Eastgate Distribution Centre — north elevation',
    contractorRef: 'halden',
  },
  electrical: {
    category: 'electrical',
    title: 'Live panel testing — main distribution board',
    description:
      'Thermographic survey and phase-rotation checks on the main LV distribution board with covers removed. Board cannot be isolated during production hours.',
    locationText: 'Eastgate Distribution Centre — plant room',
    contractorRef: 'halden',
  },
};

/**
 * Incident content. The injury figures matter: the facts have to carry
 * two independent RIDDOR triggers — a fracture that is not to a finger,
 * thumb or toe (specified injury) and an absence over seven days
 * (over-7-day) — or the screening is a prop rather than a judgement.
 *
 * The seeded record has to *agree with itself*, which the first cut did
 * not: it described a fractured wrist and two weeks off work while the
 * register showed "Severity: Minor" and "0 day(s) lost", because the
 * severity column kept its `minor` default and no person or absence row
 * was written at all. A supervisor triaging on that badge would have
 * skipped the report.
 */
export const SANDBOX_INCIDENT = {
  title: 'Fall from step ladder while changing high-bay lamp',
  kind: 'injury',
  description:
    'Operative was changing a failed high-bay lamp from a step ladder when the ladder shifted on the sloped floor. Fell approximately 1.8 m, landing on the left side. Taken to hospital; fractured wrist confirmed. Expected to be off work for around two weeks.',
  locationText: 'Northfield Works — warehouse aisle 4',
  /** Hospital admission floors severity at `serious` (`provisionalSeverity`). */
  severity: 'serious',
  /** How long before now the accident happened. */
  occurredDaysAgo: 6,
  /** Reported the same shift — a bigger gap chips the record "late report". */
  reportedHoursAfter: 2,
  person: {
    name: 'Tom Reilly',
    category: 'employee',
    injury: {
      bodyParts: ['wrist'],
      injuryKinds: ['fracture'],
      firstAidGiven: true,
      firstAidBy: 'Priya Shah',
      hospitalisation: 'admitted',
      treatmentNote:
        'Taken to A&E by a colleague; left wrist fracture confirmed and cast applied. Signed off for an expected two weeks.',
    },
  },
  /** Open absence from the day after the accident — still off, still counting. */
  absenceFromDaysAfterAccident: 1,
} as const;

/**
 * Hazard / near-miss content for the observations tile.
 *
 * Three properties the register has to have, none of which it had at
 * first: a *history* (all three were stamped with the second the
 * workspace was built, which reads as fake), a spread across both sites,
 * and one already closed — because the tile's own promise is "three
 * reports, two still open", and nothing demonstrates a resolved
 * observation if all three are open.
 */
export const SANDBOX_OBSERVATIONS = [
  {
    title: 'Fire exit blocked by stacked pallets',
    description:
      'Two stacks of empty pallets left directly in front of the fire exit at the east end of the pick aisle. Exit could not be fully opened.',
    categoryName: 'Hazard',
    siteRef: 'eastgate',
    priority: 'high',
    daysAgo: 9,
    status: 'open',
    /** Seeded only on the `withActions` refinement. */
    action: {
      title: 'Relocate the pallet stacks and mark a keep-clear zone at the east fire exit',
      description:
        'Empty pallets are being staged in front of the exit because the yard bay is full. Agree a new staging point with the shift manager and paint a hatched keep-clear zone in front of the door.',
      priority: 'high',
      /** Negative = already overdue, which is what an action board is for. */
      dueInDays: -2,
      assignTo: 'colleague',
    },
  },
  {
    title: 'Near miss — pallet fell from racking',
    description:
      'A shrink-wrapped pallet slipped from the second beam level as a truck withdrew. No one was in the aisle at the time.',
    categoryName: 'Near miss',
    siteRef: 'northfield',
    priority: 'high',
    daysAgo: 4,
    status: 'open',
    action: {
      title: 'Inspect beam level 2 in aisle 7 and re-wrap the affected pallets',
      description:
        'Check the beam and the pallet condition before the aisle is re-opened to pick traffic. Report anything bent or displaced to the racking inspector.',
      priority: 'medium',
      dueInDays: 3,
      assignTo: 'self',
    },
  },
  {
    title: 'Damaged guard on shrink-wrap machine',
    description:
      'Interlock guard on the shrink-wrap machine is cracked and no longer sits flush. Machine still running.',
    categoryName: 'Hazard',
    siteRef: 'eastgate',
    priority: 'medium',
    daysAgo: 12,
    status: 'closed',
    closedReason:
      'Machine locked off the same afternoon. Replacement interlock guard fitted by Rossi Mechanical on the next visit and the interlock function proved before the machine went back into service.',
    action: null,
  },
] as const;

/**
 * Inspection templates per refinement, expressed as `TemplateSpec` — the
 * small AI-facing shape that `buildTemplateContentFromSpec` expands into
 * schema-valid `TemplateContent`. Hand-writing the full content JSON
 * here would duplicate the builder and drift from it; going through the
 * spec means the sandbox template is built by exactly the same code path
 * as one imported from a PDF.
 *
 * Each checklist is written so a visitor can run it in under a minute
 * and get a report worth looking at: pass/fail with a flagged failure,
 * one photo prompt, one signature.
 */
export const SANDBOX_INSPECTION_SPECS: Record<string, TemplateSpec> = {
  siteWalk: parseTemplateSpec({
    title: 'Weekly site safety walkthrough',
    description: 'A short walk of the site covering housekeeping, equipment and people.',
    pages: [
      {
        title: 'Walkthrough',
        sections: [
          {
            title: 'Housekeeping and access',
            questions: [
              {
                prompt: 'Are all walkways and fire exits clear and unobstructed?',
                type: 'multipleChoice',
                required: true,
                options: [
                  { label: 'Yes', color: 'green' },
                  {
                    label: 'No',
                    color: 'red',
                    flag: true,
                    requireAction: 'Clear the obstructed route',
                  },
                  { label: 'N/A', color: 'grey' },
                ],
              },
              {
                prompt: 'Is waste segregated and stored in the designated area?',
                type: 'multipleChoice',
                options: [
                  { label: 'Yes', color: 'green' },
                  { label: 'No', color: 'red', flag: true },
                ],
              },
            ],
          },
          {
            title: 'Equipment and plant',
            questions: [
              {
                prompt: 'Are all machine guards in place and undamaged?',
                type: 'multipleChoice',
                required: true,
                options: [
                  { label: 'Yes', color: 'green' },
                  {
                    label: 'No',
                    color: 'red',
                    flag: true,
                    requireAction: 'Repair or replace the damaged guard',
                  },
                  // A distribution centre may have no guarded machinery.
                  // Without N/A the only answers are untrue or a false issue.
                  { label: 'N/A', color: 'grey' },
                ],
              },
              { prompt: 'Photo of anything that needs attention', type: 'media' },
            ],
          },
          {
            title: 'People',
            questions: [
              {
                prompt: 'Is the required PPE being worn in all designated areas?',
                type: 'multipleChoice',
                options: [
                  { label: 'Yes', color: 'green' },
                  { label: 'Mostly', color: 'amber', flag: true },
                  { label: 'No', color: 'red', flag: true },
                ],
              },
              { prompt: 'Anything else worth noting?', type: 'text', multiline: true },
            ],
          },
        ],
      },
    ],
  }),

  equipment: parseTemplateSpec({
    title: 'Plant and equipment pre-use check',
    description: 'Run before the machine is used for the first time each shift.',
    pages: [
      {
        title: 'Pre-use check',
        sections: [
          {
            title: 'Visual condition',
            questions: [
              { prompt: 'Which machine is being checked?', type: 'asset' },
              {
                prompt: 'Is the machine free from visible damage or leaks?',
                type: 'multipleChoice',
                required: true,
                options: [
                  { label: 'Yes', color: 'green' },
                  {
                    label: 'No',
                    color: 'red',
                    flag: true,
                    requireAction: 'Take the machine out of service and report the defect',
                  },
                ],
              },
              {
                prompt: 'Is the emergency stop accessible and working?',
                type: 'multipleChoice',
                required: true,
                options: [
                  { label: 'Yes', color: 'green' },
                  {
                    label: 'No',
                    color: 'red',
                    flag: true,
                    requireAction: 'Do not use — report immediately',
                  },
                ],
              },
            ],
          },
          {
            title: 'Records',
            questions: [
              {
                prompt: 'Is the statutory inspection certificate in date?',
                type: 'multipleChoice',
                options: [
                  { label: 'Yes', color: 'green' },
                  { label: 'No', color: 'red', flag: true },
                ],
              },
              { prompt: 'Checked by', type: 'signature' },
            ],
          },
        ],
      },
    ],
  }),

  vehicles: parseTemplateSpec({
    title: 'Vehicle and forklift daily check',
    description: 'Daily walk-round before the vehicle is driven.',
    pages: [
      {
        title: 'Daily check',
        sections: [
          {
            title: 'Before starting',
            questions: [
              { prompt: 'Which vehicle?', type: 'asset' },
              {
                prompt: 'Are the tyres free from damage and correctly inflated?',
                type: 'multipleChoice',
                required: true,
                options: [
                  { label: 'Yes', color: 'green' },
                  // No `requireEvidence` on any seeded template, for now.
                  //
                  // The endpoint bug that made the gate unsatisfiable is
                  // fixed (`itemAcceptsEvidence`), but object storage is
                  // still returning AccessDenied in production, so an
                  // upload cannot succeed and the gate would trap a
                  // visitor the same way — blocking Submit until they
                  // change an honest "No" to something that does not
                  // trigger. Put `requireEvidence: true` back on this
                  // option, and on the fire-exit and machine-guard
                  // questions in `siteWalk`, once a photo uploads
                  // end-to-end. It is good product behaviour and worth
                  // demonstrating; it just cannot be demonstrated while
                  // the sink is down.
                  {
                    label: 'No',
                    color: 'red',
                    flag: true,
                    requireAction:
                      'Replace or repair the defective tyre before the vehicle is used',
                  },
                ],
              },
              {
                prompt: 'Is the hydraulic system free from visible leaks?',
                type: 'multipleChoice',
                options: [
                  { label: 'Yes', color: 'green' },
                  {
                    label: 'No',
                    color: 'red',
                    flag: true,
                    requireAction: 'Report the leak to maintenance',
                  },
                ],
              },
            ],
          },
          {
            title: 'Operating checks',
            questions: [
              {
                prompt: 'Do the horn, lights and reversing alarm all work?',
                type: 'multipleChoice',
                required: true,
                options: [
                  { label: 'Yes', color: 'green' },
                  { label: 'No', color: 'red', flag: true },
                ],
              },
              { prompt: 'Odometer / hour reading', type: 'number', unit: 'hrs' },
              { prompt: 'Driver signature', type: 'signature' },
            ],
          },
        ],
      },
    ],
  }),

  fireChecks: parseTemplateSpec({
    title: 'Weekly fire safety check',
    description: 'The weekly walk required to keep the fire logbook current.',
    pages: [
      {
        title: 'Fire check',
        sections: [
          {
            title: 'Means of escape',
            questions: [
              {
                prompt: 'Are all escape routes clear and free from storage?',
                type: 'multipleChoice',
                required: true,
                options: [
                  { label: 'Yes', color: 'green' },
                  {
                    label: 'No',
                    color: 'red',
                    flag: true,
                    requireAction: 'Clear the escape route immediately',
                  },
                ],
              },
              {
                prompt: 'Do all final exit doors open freely from the inside?',
                type: 'multipleChoice',
                required: true,
                options: [
                  { label: 'Yes', color: 'green' },
                  { label: 'No', color: 'red', flag: true },
                ],
              },
            ],
          },
          {
            title: 'Fire equipment',
            questions: [
              {
                prompt: 'Are extinguishers in place, sealed and in date?',
                type: 'multipleChoice',
                options: [
                  { label: 'Yes', color: 'green' },
                  { label: 'No', color: 'red', flag: true },
                ],
              },
              {
                prompt: 'Has the weekly call-point test been completed and logged?',
                type: 'multipleChoice',
                options: [
                  { label: 'Yes', color: 'green' },
                  { label: 'No', color: 'red', flag: true },
                ],
              },
              { prompt: 'Completed by', type: 'signature' },
            ],
          },
        ],
      },
    ],
  }),
};

/**
 * The in-progress inspection the visitor finds waiting in the register.
 *
 * `answeredSections` is how many of the template's sections a colleague
 * got through before being called away. The first cut of this seed wrote
 * the inspection row and nothing else, so the tile promised "one
 * inspection already underway" and delivered a title, a date and a
 * status badge with all ten answers blank. Nothing was underway. The
 * answers are filled in by walking the built content, so they cannot
 * drift from whatever the spec produces.
 */
export const SANDBOX_INSPECTION_RUN = {
  titleSuffix: 'Eastgate Distribution Centre',
  /** Stop part-way — the unfinished part is what the visitor picks up. */
  answeredSections: 2,
  /** Free-text left by the colleague on any text question they reached. */
  textAnswer: 'Aisle 7 racking inspection due next week — flagged to the shift manager.',
} as const;

/**
 * COSHH substance for the COSHH refinement of the risk-assessment tile.
 *
 * The assessment is filled in, and that is the point. The first cut
 * seeded a row with a task description and nothing else — no routes of
 * exposure, no exposed groups, no quantities, and **no controls at any
 * of the six tiers** — while badging it `active`. A COSHH assessment
 * with zero recorded controls is not a valid assessment, and this is
 * the one module where an empty shell actively misrepresents what good
 * looks like: the visitor's first sight of the product's own standard
 * is a record that would fail an inspection.
 *
 * The controls deliberately run down the hierarchy and stop short of
 * PPE-only — engineering and administrative measures first, RPE last
 * and justified, which is the discipline the editor prompts for.
 */
export const SANDBOX_COSHH = {
  name: 'Sodium hypochlorite 10% (bulk cleaning)',
  supplier: 'Halden Chemical Supplies',
  taskDescription:
    'Decanting and dilution of bulk sodium hypochlorite for daily floor and drain cleaning across the production area.',
  routesOfExposure: ['inhalation', 'skin', 'eyes'],
  personsExposed: ['employees', 'cleaners'],
  personsCount: 6,
  quantityBand: 'medium',
  frequencyBand: 'daily',
  durationBand: '15_60_min',
  levRequired: true,
  healthSurveillanceRequired: false,
  exposureMonitoringRequired: false,
  emergencyNotes:
    'Eye wash station at the chemical store and in the wash bay. Splash to the eye: irrigate for 15 minutes and seek medical attention. Never mix with acidic descaler — chlorine gas is released; evacuate and ventilate if mixing is suspected.',
  plainSummary:
    'Bleach for floors and drains. It burns eyes and skin, and the fumes catch your chest. Use the dosing unit, wear the goggles and gauntlets, and never mix it with anything else.',
  controls: [
    {
      tier: 'substitution',
      description:
        'Lowest effective concentration specified for routine floor cleaning; the 10% stock is reserved for drains.',
    },
    {
      tier: 'engineering',
      description:
        'Wall-mounted venturi dosing unit dilutes at the tap, so operators never pour from the bulk container.',
    },
    {
      tier: 'engineering',
      description:
        'Mechanical ventilation running in the wash bay whenever drain cleaning is done.',
    },
    {
      tier: 'administrative',
      description:
        'Decanting restricted to trained cleaning staff; acidic descalers stored in a separate cabinet to prevent mixing.',
    },
    {
      tier: 'ppe',
      description: 'Chemical splash goggles and nitrile gauntlets worn for every decant.',
    },
  ],
} as const;

/** Building for the fire refinement of the risk-assessment tile. */
export const SANDBOX_FIRE_BUILDING = {
  name: 'Eastgate Distribution Centre — main warehouse',
  fraTitle: 'Fire risk assessment — Eastgate main warehouse',
} as const;

/**
 * RAMS pack for the RAMS tile — the pack the visitor builds or issues.
 *
 * The steps are the point. A pack with a reference number, a title and
 * nothing under it is an empty shell: there is nothing to read, nothing
 * to judge, and the "before you can issue" gate has nothing to act on.
 * Four sequenced steps with hazards, PPE and a hold point is a document
 * a reviewer can actually form a view about.
 */
export const SANDBOX_RAMS_PACK = {
  title: 'Conveyor frame repair — hot works, Line 3',
  description:
    'Method statement and risk assessment covering the MIG welding repair to the Line 3 conveyor frame, including hot-work controls and fire watch.',
  steps: [
    {
      title: 'Isolate and prepare the work area',
      description:
        'Line 3 stopped, locked off at the local isolator and the key retained by the supervisor. Barrier off the mezzanine bay and post a hot-work sign at each approach.',
      controlNotes:
        'Isolation proved dead at the point of work before any access. Permit to work raised and issued before tools are opened.',
      ppe: ['safety_helmet', 'safety_footwear', 'hi_vis', 'gloves'],
    },
    {
      title: 'Protect the sprinkler head and clear combustibles',
      description:
        'Fit a heat shield below the sprinkler head within 6 m of the weld position. Move stored cardboard packaging beyond 10 m or cover with a fire blanket.',
      controlNotes:
        'Sprinkler system stays in service — no isolation of detection or suppression without written authorisation from the responsible person.',
      ppe: ['safety_helmet', 'safety_footwear', 'hi_vis', 'gloves'],
      holdPoint: {
        kind: 'supervisor_check',
        description:
          'Fire precautions verified in place — heat shield fitted, combustibles cleared, extinguisher and fire watch present — before any ignition source is used.',
        responsibleRole: 'Permit issuer',
      },
    },
    {
      title: 'Weld the replacement bracket',
      description:
        'MIG weld the replacement support bracket to the conveyor frame in two passes, checking distortion between passes. Welding screens in position on both sides of the bay.',
      controlNotes:
        'Extinguisher at the point of work throughout. Local exhaust ventilation on the weld position for fume.',
      ppe: ['welding_ppe', 'gloves', 'safety_footwear', 'coveralls', 'respiratory_protection'],
    },
    {
      title: 'Fire watch, reinstate and hand back',
      description:
        'Maintain a fire watch on the bay and the deck below for 60 minutes after the last ignition source. Remove the heat shield, sweep the area and restore the guarding before de-isolating.',
      controlNotes:
        'Permit closed back to the issuer only after the fire watch has run its full hour and the area has been confirmed cool.',
      ppe: ['safety_helmet', 'safety_footwear', 'hi_vis'],
    },
  ],
  emergency: {
    firstAid:
      'Two first aiders on the Northfield shift; nearest kit is in the maintenance workshop. Burn kit held with the hot-work trolley.',
    emergencyProcedure:
      'Raise the alarm at the nearest call point, evacuate the mezzanine by the north stair and muster in the goods yard. The fire watch does not leave until relieved by the incident controller.',
    nearestHospital: 'Nearest A&E is 4.5 miles; site ambulance access is via the north gate.',
  },
  logistics: {
    permitsRequired:
      'Hot work permit. A separate work-at-height permit is required if any part of the repair is carried out from the MEWP rather than the mezzanine deck.',
    competence:
      'Welders to hold current coded-welding certification. All operatives inducted to the site and briefed on this pack before starting.',
    environmental:
      'Weld fume extracted at source. No hot metal, slag or consumables to be swept into the yard drainage.',
  },
} as const;

/**
 * A contractor's pack sitting in the review queue — the `reviewPack`
 * refinement's whole reason to exist.
 *
 * This is the tile that was most obviously broken: the visitor asked to
 * "review a contractor's RAMS" and the review page said "No contractor
 * packs awaiting review", because the seed built *our own* draft pack —
 * which is what a different refinement produces. `rams_reviews` carries
 * a nullable `contractorDocumentId` precisely for a pack logged from an
 * email rather than uploaded through the portal, which is the honest
 * shape for a seeded one.
 */
export const SANDBOX_RAMS_REVIEW = {
  title: 'Halden Electrical — LV distribution board upgrade RAMS',
  contractorRef: 'halden',
  workDescription:
    'Contractor-supplied RAMS covering the replacement of the main LV distribution board at Eastgate over a weekend shutdown, including temporary supplies, isolation and re-energisation.',
  siteRef: 'eastgate',
  /** Received last week — a queue with no age reads as staged. */
  receivedDaysAgo: 5,
} as const;

/**
 * Gas readings recorded before the seeded permit was issued.
 *
 * The hot-work and confined-space types both have "gas testing
 * required" switched on, and the permit page states the acceptable
 * limits and says the gate evaluates readings against them. Handing the
 * visitor a permit that was issued with no readings at all made that
 * sentence a lie — the register showed "No readings recorded yet"
 * against a permit already issued and awaiting acceptance. Values are
 * inside the seeded limits so the snapshotted verdict is a pass.
 */
export const SANDBOX_GAS_READINGS: Record<
  string,
  ReadonlyArray<{ limitId: string; value: number }>
> = {
  hot_work: [{ limitId: 'flammables_lel', value: 0 }],
  confined_space: [
    { limitId: 'oxygen', value: 20.9 },
    { limitId: 'flammables_lel', value: 0 },
    { limitId: 'carbon_monoxide', value: 2 },
  ],
};
