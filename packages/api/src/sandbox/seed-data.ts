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
 * Incident content. The injury figures matter: seven days lost puts
 * this over the RIDDOR over-7-day threshold, which is what makes the
 * reportability screening a real decision rather than a demo prop.
 */
export const SANDBOX_INCIDENT = {
  title: 'Fall from step ladder while changing high-bay lamp',
  kind: 'injury',
  description:
    'Operative was changing a failed high-bay lamp from a step ladder when the ladder shifted on the sloped floor. Fell approximately 1.8 m, landing on the left side. Taken to hospital; fractured wrist confirmed. Expected to be off work for around two weeks.',
  locationText: 'Northfield Works — warehouse aisle 4',
  daysLost: 9,
} as const;

/** Hazard / near-miss content for the observations tile. */
export const SANDBOX_OBSERVATIONS = [
  {
    title: 'Fire exit blocked by stacked pallets',
    description:
      'Two stacks of empty pallets left directly in front of the fire exit at the east end of the pick aisle. Exit could not be fully opened.',
    categoryName: 'Hazard',
    needsAction: true,
  },
  {
    title: 'Near miss — pallet fell from racking',
    description:
      'A shrink-wrapped pallet slipped from the second beam level as a truck withdrew. No one was in the aisle at the time.',
    categoryName: 'Near miss',
    needsAction: true,
  },
  {
    title: 'Damaged guard on shrink-wrap machine',
    description:
      'Interlock guard on the shrink-wrap machine is cracked and no longer sits flush. Machine still running.',
    categoryName: 'Hazard',
    needsAction: false,
  },
] as const;

/** Inspection template content per refinement, as question prompts. */
export const SANDBOX_INSPECTIONS: Record<
  string,
  {
    readonly title: string;
    readonly sections: ReadonlyArray<{ title: string; questions: readonly string[] }>;
  }
> = {
  siteWalk: {
    title: 'Weekly site safety walkthrough',
    sections: [
      {
        title: 'Housekeeping and access',
        questions: [
          'Are all walkways and fire exits clear and unobstructed?',
          'Is waste segregated and stored in the designated area?',
          'Are spill kits present and fully stocked?',
        ],
      },
      {
        title: 'Equipment and plant',
        questions: [
          'Are all machine guards in place and undamaged?',
          'Is lifting equipment within its inspection date?',
          'Are electrical leads free from visible damage?',
        ],
      },
      {
        title: 'People',
        questions: [
          'Is the required PPE being worn in all designated areas?',
          'Are permits displayed for any high-risk work in progress?',
        ],
      },
    ],
  },
  equipment: {
    title: 'Plant and equipment pre-use check',
    sections: [
      {
        title: 'Visual condition',
        questions: [
          'Is the machine free from visible damage or leaks?',
          'Are all guards and interlocks fitted and functional?',
          'Is the emergency stop accessible and working?',
        ],
      },
      {
        title: 'Records',
        questions: [
          'Is the statutory inspection certificate in date?',
          'Has the daily check sheet been completed for today?',
        ],
      },
    ],
  },
  vehicles: {
    title: 'Vehicle and forklift daily check',
    sections: [
      {
        title: 'Before starting',
        questions: [
          'Are the tyres free from damage and correctly inflated?',
          'Are the forks and mast free from cracks or distortion?',
          'Is the hydraulic system free from visible leaks?',
        ],
      },
      {
        title: 'Operating checks',
        questions: [
          'Do the horn, lights and reversing alarm all work?',
          'Does the seat belt latch and retract correctly?',
          'Are the service and parking brakes effective?',
        ],
      },
    ],
  },
  fireChecks: {
    title: 'Weekly fire safety check',
    sections: [
      {
        title: 'Means of escape',
        questions: [
          'Are all escape routes clear and free from storage?',
          'Do all final exit doors open freely from the inside?',
          'Is emergency lighting operating on test?',
        ],
      },
      {
        title: 'Fire equipment',
        questions: [
          'Are extinguishers in place, sealed and in date?',
          'Has the weekly call-point test been completed and logged?',
          'Are fire doors closing fully onto their rebates?',
        ],
      },
    ],
  },
};
