/**
 * Copy for the try-it-now funnel (ADR 0017).
 *
 * Public, pre-account surface — so it follows the same convention as the
 * rest of the marketing site (`content/site.ts`): plain data in a `.ts`
 * module outside `app/`, English-only by design, brand identity pulled
 * from the brand catalogue rather than hardcoded. The moment the visitor
 * lands inside the app, copy switches to the i18n catalogue like every
 * other in-product surface.
 *
 * Tile labels are the visitor's vocabulary, not the module's. "Permits
 * to work" is a job an H&S manager recognises; `permits` is a row in our
 * nav. Level 2 forks what actually gets built — a refinement is only
 * here if a different answer produces a visibly different workspace.
 */
import type { SandboxScenarioId } from '@forma360/shared/sandbox-scenarios';
import { activeBrand } from '../lib/brand';

export const TRY_PAGE = {
  eyebrow: 'No account needed',
  title: 'What do you need to get done?',
  subtitle: `Pick one and we'll build you a working ${activeBrand.name} workspace, set up around it. Takes about a minute.`,
  refineHeading: 'Which one?',
  continueCta: 'Build my workspace',
  backCta: 'Back',
  buildingTitle: 'Building your workspace',
  buildingNote: 'This takes a few seconds.',
  errorTitle: "That didn't work",
  errorBody: 'We could not build the workspace just now. Please try again.',
  errorRetry: 'Try again',
  rateLimited: "You've created a few workspaces already. Try again in an hour.",
  alreadySignedIn: "You're already signed in — opening your workspace.",
  footNote: 'Nothing is saved to your name until you ask us to. No card, no commitment.',
} as const;

export interface TryTileCopy {
  readonly label: string;
  readonly blurb: string;
  /** Level-2 question for this tile. */
  readonly refineQuestion: string;
  readonly refinements: Readonly<Record<string, string>>;
  /** Shown while the workspace is being built — quotes the choice back. */
  readonly buildingSteps: readonly string[];
}

export const TRY_TILES: Readonly<Record<SandboxScenarioId, TryTileCopy>> = {
  riskAssessment: {
    label: 'Risk assessments',
    blurb: 'Assess an activity, sign it off, share it with the people it covers.',
    refineQuestion: 'What kind of assessment?',
    refinements: {
      general: 'General workplace',
      coshh: 'COSHH — hazardous substances',
      fire: 'Fire risk assessment',
      manualHandling: 'Manual handling',
    },
    buildingSteps: [
      'Creating your workspace',
      'Adding two sites and your team',
      'Drafting a risk assessment with worked hazards',
      'Leaving one hazard for you to rate',
    ],
  },
  inspection: {
    label: 'Inspections & audits',
    blurb: 'Run a checklist on site, capture photos, produce a signed report.',
    refineQuestion: 'What are you inspecting?',
    refinements: {
      siteWalk: 'Site walkthrough',
      equipment: 'Machinery & plant',
      vehicles: 'Vehicles & forklifts',
      fireChecks: 'Fire safety checks',
    },
    buildingSteps: [
      'Creating your workspace',
      'Adding two sites and your team',
      'Setting up your inspection register',
    ],
  },
  hazard: {
    label: 'Hazards & near misses',
    blurb: 'Let anyone report what they see, then turn it into action.',
    refineQuestion: 'What happens after someone reports one?',
    refinements: {
      captureOnly: 'Just capture it',
      withActions: 'Capture and assign corrective actions',
      anonymous: 'Anonymous reporting by QR code',
    },
    buildingSteps: [
      'Creating your workspace',
      'Adding two sites and your team',
      'Logging three reports, two still open',
    ],
  },
  permit: {
    label: 'Permits to work',
    blurb: 'Authorise high-risk work, with the checks that have to happen first.',
    refineQuestion: 'Which permits?',
    refinements: {
      hotWork: 'Hot work',
      confinedSpace: 'Confined space',
      workingAtHeight: 'Working at height',
      electrical: 'Electrical',
    },
    buildingSteps: [
      'Creating your workspace',
      'Adding two sites and your contractors',
      'Loading the nine permit types',
      'Raising a permit that needs your decision',
    ],
  },
  incident: {
    label: 'Incidents & accidents',
    blurb: 'Record what happened, work out if it is reportable, investigate it.',
    refineQuestion: 'How far do you need to take it?',
    refinements: {
      recordOnly: 'Record it',
      withInvestigation: 'Record and investigate',
      withRiddor: 'Record, investigate and check RIDDOR',
    },
    buildingSteps: [
      'Creating your workspace',
      'Adding two sites and your team',
      'Setting up your incident register',
    ],
  },
  rams: {
    label: 'Contractors & RAMS',
    blurb: 'Review contractor method statements before anyone starts work.',
    refineQuestion: 'What do you need to do first?',
    refinements: {
      reviewPack: "Review a contractor's RAMS",
      buildPack: 'Build our own RAMS pack',
      contractorDocs: 'Check documents and insurance',
    },
    buildingSteps: [
      'Creating your workspace',
      'Adding two sites and your contractors',
      'Setting up your RAMS register',
    ],
  },
};
