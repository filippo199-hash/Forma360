/**
 * Guides for the register modules: risk assessments, COSHH, fire safety
 * and RAMS. Part of the guide library — see `./index.ts` for conventions
 * and brand gating (all four modules are brand-gated).
 */
import type { Guide } from './index';

export const REGISTER_GUIDES: readonly Guide[] = [
  // ─── Risk assessments ──────────────────────────────────────────────────────
  {
    slug: 'write-a-risk-assessment',
    title: 'Write a risk assessment',
    area: 'risk-assessments',
    summary:
      'The HSE five-step method in the editor — hazards, who might be harmed, controls, and scores that have to make sense.',
    minutes: 7,
    sections: [
      {
        heading: 'Start the assessment',
        steps: [
          'Open Risk assessments and create a new assessment; name the activity and the site it covers.',
          'Add hazards — from the hazard library, which carries harmed-group presets and control suggestions, or from scratch when the risk is particular to you.',
        ],
        tip: 'Assess the activity, not the building. “Using the bench grinder” produces controls someone can follow; “the workshop” produces a poster.',
      },
      {
        heading: 'Who might be harmed, and how',
        steps: [
          'For each hazard, record who could be harmed — operators, cleaners, visitors, residents and service users — and how the harm would happen.',
          'Be specific enough that a new starter could read it and recognise the situation.',
        ],
      },
      {
        heading: 'Controls, then score',
        steps: [
          'List the controls already in place, honestly — what actually happens, not what the old document says.',
          'Score likelihood and severity on your organisation’s matrix; the banding is shared, so every assessor’s red means the same red.',
          'Add the further controls needed, then score the residual risk. The residual score must be coherent with the controls you added — the editor will not let controls that change nothing claim a lower number.',
        ],
        note: 'Severity floors stop a hazard that could kill being scored trivially: some severities cannot be rated down, whatever the likelihood.',
      },
      {
        heading: 'Before you publish',
        bullets: [
          'Read it as the person doing the job. Would they recognise the task? Could they follow the controls?',
          'Check the review date — the register will chase it, so make it a date you mean.',
          'Publishing is covered in “Publish, sign off and get it acknowledged” — drafting and publishing are different jobs.',
        ],
      },
    ],
  },
  {
    slug: 'publish-sign-and-acknowledge',
    title: 'Publish, sign off and get it acknowledged',
    area: 'risk-assessments',
    summary:
      'Freeze a signed version, send it to the people it protects, and let the chase run until everyone has signed.',
    minutes: 5,
    sections: [
      {
        heading: 'Publish a signed version',
        steps: [
          'From the draft, publish the assessment. Publishing freezes an immutable version carrying the assessor’s sign-off — name, date, content.',
          'Later edits happen on the live document and publish as the next version. What people acknowledged never changes underneath them.',
        ],
        note: 'This is the property an inspector actually checks: not whether the document is current, but whether you can show what it said on a given date and who had signed it.',
      },
      {
        heading: 'Send it for acknowledgement',
        steps: [
          'Choose the people the assessment covers and request their acknowledgement.',
          'Each person finds it in their “For me” queue and acknowledges the specific version they read.',
          'A daily reminder chases whoever is outstanding — and goes quiet the moment they sign.',
        ],
        tip: 'Acknowledge-by-version is the point: after a re-issue, the register shows exactly who has seen the new edition and who is still working on the old one.',
      },
      {
        heading: 'Keep it alive',
        bullets: [
          'The register’s attention strip shows assessments due for review, unsigned versions and outstanding acknowledgements.',
          'An incident involving the risk can pull the review forward to today — the platform prompts it, so the assessment answers to what actually happened.',
          'Download the PDF or use the one-page print layout when someone needs it on paper.',
        ],
      },
    ],
  },
  {
    slug: 'customise-your-risk-matrix',
    title: 'Customise your risk matrix',
    area: 'risk-assessments',
    summary:
      'Set the matrix your assessors score on — labels, bands and severity floors — once, for the whole organisation.',
    minutes: 4,
    sections: [
      {
        heading: 'Open the matrix editor',
        steps: [
          'Open Settings → Risk matrix — administrator territory, because the matrix is organisation-wide by design.',
          'Review the default 5×5: likelihood and severity labels, and the band each cell falls into.',
        ],
      },
      {
        heading: 'Make it yours — within the guardrails',
        steps: [
          'Rename likelihood and severity levels into your organisation’s vocabulary.',
          'Adjust which cells fall into which band, where your scheme genuinely differs.',
        ],
        bullets: [
          'Banding is shared: every assessment in the workspace scores on this one matrix, so two assessors cannot produce different colours for the same score.',
          'Severity floors hold: the highest severities cannot be banded down to trivial, whatever the likelihood — the matrix will not accept it.',
        ],
        note: 'Existing assessments keep their published versions untouched; the matrix governs how new scoring reads.',
      },
      {
        heading: 'When to change it',
        bullets: [
          'Match an existing corporate scheme when you arrive with one — assessors should not translate in their heads.',
          'Otherwise, the default is a sound HSE-style matrix; the best matrix is usually the one you stop discussing.',
        ],
      },
    ],
  },

  // ─── COSHH ─────────────────────────────────────────────────────────────────
  {
    slug: 'build-your-coshh-inventory',
    title: 'Build your substance inventory',
    area: 'coshh',
    summary:
      'Add substances by uploading the safety data sheet and letting the AI draft the record — then say where each one is stocked.',
    minutes: 5,
    sections: [
      {
        heading: 'Add a substance from its SDS',
        steps: [
          'Open COSHH and add a substance.',
          'Upload the safety data sheet — the PDF from the supplier. The AI import reads it and drafts the record: product name, signal word, hazard statements, PPE, storage and first-aid measures.',
          'Review the draft against the sheet and confirm. You keep the judgement; the machine does the typing.',
        ],
        tip: 'Chase current sheets as you go — the import makes re-doing a substance cheap, so an updated SDS is ten minutes, not an afternoon.',
      },
      {
        heading: 'Say where it is stocked',
        steps: [
          'Record the stock locations — which sites hold the substance.',
          'Site views scope by this: a site’s COSHH picture shows the substances actually on its shelves, and an assessment belongs to every site its substance is stocked at.',
        ],
      },
      {
        heading: 'Keep the inventory honest',
        bullets: [
          'Set review dates; the register flags what is due.',
          'Retire substances you no longer hold — an inventory padded with ghosts fails an audit as surely as a missing one.',
          'The original SDS stays attached to the record, so the source is always one click from the summary.',
        ],
      },
    ],
  },
  {
    slug: 'write-a-coshh-assessment',
    title: 'Write a COSHH assessment',
    area: 'coshh',
    summary:
      'Assess the task, not just the substance — exposure, controls and limits, published as a signed version.',
    minutes: 6,
    sections: [
      {
        heading: 'Assess the task',
        steps: [
          'From the substance, create the assessment for the task that uses it — “degreasing parts”, not “acetone in general”.',
          'Work through exposure routes, who is exposed, and the controls: ventilation, PPE, storage, hygiene, emergency measures.',
        ],
        tip: 'One substance, several tasks, several assessments is normal. Spraying and wiping are different exposures wearing the same label.',
      },
      {
        heading: 'Record the limits',
        steps: [
          'Enter the workplace exposure limits that apply, from the SDS and EH40.',
          'Record monitoring results against them as you get them — a result over the limit is flagged rather than filed.',
        ],
      },
      {
        heading: 'Publish a signed version',
        steps: [
          'Publish when the assessment is ready. Publishing freezes a signed, immutable copy — the version that was attested.',
          'Edit the live assessment whenever reality changes; publishing again writes the next version, and the old ones stay readable.',
        ],
        note: 'The signed copy is what protects the assessor: an assessment edited after the event with no version history protects nobody.',
      },
    ],
  },
  {
    slug: 'coshh-at-the-point-of-work',
    title: 'COSHH at the point of work',
    area: 'coshh',
    summary:
      'One-page cards where the substance is used, and the LEV register that keeps extraction honest.',
    minutes: 4,
    sections: [
      {
        heading: 'Point-of-work cards',
        steps: [
          'Open COSHH → Point of work.',
          'For each substance in use, the card distils the record to what the person holding the bottle needs: hazards, PPE, spill response, first aid.',
          'Print it for the workstation or open it on a phone — it always reflects the current version, so a re-assessment updates the wall copy by itself.',
        ],
        tip: 'The card is for the user; the assessment is for the assessor. If a card needs a second page, the task probably needs a second assessment.',
      },
      {
        heading: 'The LEV register',
        steps: [
          'Open COSHH → LEV and record your local exhaust ventilation plant — the extraction that makes several of your assessments true.',
          'Record the statutory examinations with their dates; the register shows what is in date and what is due.',
        ],
        note: 'LEV lives inside COSHH deliberately: an extraction set that fails its test quietly invalidates every assessment that leans on it, and keeping them together makes that visible.',
      },
    ],
  },

  // ─── Fire safety ───────────────────────────────────────────────────────────
  {
    slug: 'set-up-your-fire-register',
    title: 'Set up buildings and the fire register',
    area: 'fire-safety',
    summary:
      'Register each building, let the regulations thresholds classify it, and see the whole fire file in one record.',
    minutes: 5,
    sections: [
      {
        heading: 'Register the buildings',
        steps: [
          'Open Fire safety and add each building: which site it belongs to, its height, storeys and use.',
          'The record classifies the building against the Fire Safety (England) Regulations thresholds — 11 metres, 18 metres, seven storeys — so the duties that apply are stated, not guessed.',
        ],
      },
      {
        heading: 'One building, one file',
        bullets: [
          'Each building record carries its fire risk assessment, logbook, fire doors, drills, PEEPs and marshals as tabs of one file.',
          'The register view across buildings shows the headline states — FRA status, failed checks, due items — so the portfolio reads at a glance.',
        ],
        tip: 'Set the building file up completely for one building before rolling out to twenty — the first one teaches you your own conventions.',
      },
      {
        heading: 'What to do next',
        bullets: [
          'Complete the fire risk assessment — see “Complete a fire risk assessment”.',
          'Start the logbook rhythms — see “Keep the fire logbook”.',
          'Import fire doors in bulk by pasting your existing door schedule — the parser turns the list into door records.',
        ],
      },
    ],
  },
  {
    slug: 'complete-a-fire-risk-assessment',
    title: 'Complete a fire risk assessment',
    area: 'fire-safety',
    summary:
      'The FRA editor — persons at risk, ignition and fuel, evaluation, findings — published as a frozen, attestable version.',
    minutes: 7,
    sections: [
      {
        heading: 'Work through the assessment',
        steps: [
          'From the building record, open the FRA and work through its sections: persons at risk, sources of ignition, fuel and oxygen, the evaluation, and your findings.',
          'Record findings as actionable items — each one can become tracked work, not a paragraph in a PDF.',
        ],
        note: 'Publish gates hold the standard: an FRA cannot publish with persons-at-risk, the fire triangle or the evaluation left empty — a half-done FRA that looks done is the failure mode the gate exists to stop.',
      },
      {
        heading: 'Ratings with consequences',
        bullets: [
          'An intolerable risk rating must carry an actionable finding — and alerts the people who manage fire safety the moment it is recorded.',
          'Findings can raise actions with owners and due dates, so the FRA’s conclusions land on the actions board rather than in a drawer.',
        ],
      },
      {
        heading: 'Publish, and keep it defensible',
        steps: [
          'Publish the FRA. Publishing freezes a version — the copy that was assessed and signed.',
          'Keep the live document current as the building changes; each publish writes the next version, and old versions remain readable.',
          'When the record changes materially after sign-off, the attestation is marked stale and re-attestation is requested — a signature from before the change does not silently cover what came after.',
        ],
        tip: 'Export the FRA PDF for the responsible person, the landlord or the fire service — it renders from the frozen version, so everyone reads the same document.',
      },
    ],
  },
  {
    slug: 'keep-the-fire-logbook',
    title: 'Keep the fire logbook',
    area: 'fire-safety',
    summary:
      'Checks on British Standard rhythms, failures that stay red until cleared, and the drills, PEEPs and marshals beside them.',
    minutes: 6,
    sections: [
      {
        heading: 'Run the checks',
        steps: [
          'Open the building’s logbook — or Fire safety → Logbook for the whole estate’s checks in one place.',
          'The check catalogue knows the standard rhythms — weekly alarm tests, monthly emergency lighting, annual extinguishers — so what is due builds itself.',
          'Record each check as a pass or a failure, with notes and photos where they help.',
        ],
      },
      {
        heading: 'When a check fails',
        bullets: [
          'A failure holds a red failed state on that item until a later pass clears it — it cannot scroll away into history.',
          'A follow-up action is raised by default, owned and due-dated like any other action.',
          'The building record and the register both show the failed state, so nobody has to remember which extinguisher was the problem.',
        ],
        note: 'This is the difference from a paper logbook: paper records that a test happened; the register holds the state the test left behind.',
      },
      {
        heading: 'Drills, PEEPs and marshals',
        steps: [
          'Record drills with their outcomes — date, duration, what went wrong, what to fix.',
          'Keep PEEPs for the people who need them, on the building they apply to.',
          'Track marshal cover per building against a target; competence reads from training records, or free-text for people outside the system.',
        ],
      },
      {
        heading: 'The two outputs worth knowing',
        bullets: [
          'The daily digest emails what is due across the estate — the morning list, without opening the app.',
          'The night pack renders the whole building file to one PDF for the person on call: FRA summary, checks, doors, PEEPs, marshals.',
        ],
      },
    ],
  },

  // ─── RAMS ──────────────────────────────────────────────────────────────────
  {
    slug: 'write-a-method-statement',
    title: 'Write a method statement',
    area: 'rams',
    summary:
      'Sequenced steps with PPE, plant and hold points — built once in the library, reused across packs.',
    minutes: 5,
    sections: [
      {
        heading: 'Start in the library',
        steps: [
          'Open RAMS → Library. Eight starter templates cover common trades — start from the nearest one rather than a blank page.',
          'Create your statement; it gets its own MS reference for citing in packs and permits.',
        ],
      },
      {
        heading: 'Write the sequence',
        steps: [
          'Break the job into ordered steps — the sequence is dense and numbered, the way a supervisor briefs it.',
          'On each step, record the PPE, plant and trades involved, and mark hold points where work must stop for a check before continuing.',
        ],
        tip: 'Write steps for the person doing the work on a wet Tuesday. If a step cannot be done as written, it will not be done as written.',
      },
      {
        heading: 'Keep the library working',
        bullets: [
          'A statement is reusable: one “roof access” statement serves every pack that includes roof access.',
          'Editing a library statement does not alter packs already issued — issue freezes what was sent.',
        ],
      },
    ],
  },
  {
    slug: 'build-and-issue-a-rams-pack',
    title: 'Build and issue a RAMS pack',
    area: 'rams',
    summary:
      'Bind real risk-assessment versions, reference their hazards from the steps, and pass the gate that refuses an incoherent pack.',
    minutes: 7,
    sections: [
      {
        heading: 'Start the pack',
        steps: [
          'Open RAMS and start a new pack for the job — it gets its own RAMS reference.',
          'Bind the risk assessments and COSHH assessments that govern the work. Binding is by published version, and suggested bindings rank your own registers against the job — a deterministic rule, not a guess.',
        ],
      },
      {
        heading: 'Build the method against the hazards',
        steps: [
          'Open the pack builder and bring in method-statement steps from the library, or write steps for this pack.',
          'Where a step controls a hazard, reference the hazard from the bound assessment version — the step points at the real hazard rather than restating it in different words.',
        ],
        note: 'This referencing model is what keeps a pack coherent: the method cannot quietly drift away from the assessment it claims to implement.',
      },
      {
        heading: 'Pass the gate and issue',
        steps: [
          'Issue the pack. The gate checks it first — its headline rule refuses a pack where a high-residual hazard in a bound assessment is addressed by no step.',
          'Fix what the gate names, then issue. Issuing freezes the full snapshot — statements, steps, bound hazards — and records the author’s attestation.',
          'Download the pack PDF for the job file; it renders from the frozen version.',
        ],
        tip: 'When a bound risk assessment is later revised, the issued pack does not change — re-issue deliberately, as version two, when the job should pick up the new assessment.',
      },
    ],
  },
  {
    slug: 'brief-and-send-rams',
    title: 'Brief the workforce and send the pack out',
    area: 'rams',
    summary:
      'Version-anchored briefings with signatures — plus client issue by link, and the review queue for packs contractors send you.',
    minutes: 6,
    sections: [
      {
        heading: 'Brief the gang',
        steps: [
          'From the issued pack, record a briefing: who was briefed, when, with signatures captured on the device.',
          'Brief a whole gang in one batch — each person signs against the exact pack version they were briefed on.',
          'On site without signal, briefings queue offline and sync later. A sync failure is surfaced loudly, never silently lost.',
        ],
        note: 'Briefings are append-only and version-anchored — after a re-issue you are warned that existing briefings cover the old version, and the old records stay intact as evidence of what was briefed on the day.',
      },
      {
        heading: 'Issue to a client',
        steps: [
          'Send the pack to a client on a share link — they read it without an account.',
          'Their acceptance decision is recorded against the exact version they read, on your record.',
          'Re-issuing generates the next version to send; the link history keeps who accepted what.',
        ],
      },
      {
        heading: 'Review packs contractors send you',
        steps: [
          'Incoming RAMS from your contractors land in RAMS → Reviews, attached to the contractor’s record.',
          'Review against the checklist — assessments present, method adequate, competence stated — and record the outcome.',
          'An in-date accepted review can satisfy a permit type that requires RAMS, so the permit gate and the review queue speak to each other.',
        ],
        tip: 'Review the method against your site’s reality, not just its grammar. The checklist keeps the review honest; your local knowledge makes it useful.',
      },
    ],
  },
];
