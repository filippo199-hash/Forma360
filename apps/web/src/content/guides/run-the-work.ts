/**
 * Guides for the day-to-day modules: inspections, hazard reporting,
 * incidents, permits to work and actions. Part of the guide library —
 * see `./index.ts` for conventions and brand gating.
 */
import type { Guide } from './index';

export const WORK_GUIDES: readonly Guide[] = [
  // ─── Inspections ───────────────────────────────────────────────────────────
  {
    slug: 'build-an-inspection-template',
    title: 'Build and publish an inspection template',
    area: 'inspections',
    summary:
      'From a blank template to a published checklist your team can run — sections, response sets, logic and signatures.',
    minutes: 8,
    sections: [
      {
        heading: 'Create the template',
        steps: [
          'Open Inspections → Templates and create a new template.',
          'Name it for the job — “Weekly warehouse walk”, “Forklift pre-use” — and set how conducted inspections will be titled.',
          'Add sections for the walk’s natural chapters, then questions inside each one.',
        ],
        tip: 'Build the template in the order someone walks the route, not the order the policy document lists topics. A checklist that fights the route gets pencil-whipped.',
      },
      {
        heading: 'Pick response types that grade themselves',
        bullets: [
          'Choose from response types like pass/fail, multiple choice, text, numbers, dates, media and signatures.',
          'Response sets — shared answer scales like “Good / Fair / Poor” — keep grading consistent across templates, and updating a global set flows into templates that use it.',
          'Mark responses that should count as failures, so a bad answer can be flagged and followed up rather than buried in the report.',
        ],
      },
      {
        heading: 'Add logic so the form stays short',
        steps: [
          'Attach logic to a question so follow-ups appear only when they apply — “If ‘Damage found’, show the photo and severity questions.”',
          'Nest logic where the job needs it; the editor keeps the structure visible so you can see what triggers what.',
        ],
        tip: 'Every question the conductor can see costs attention. Logic is how a thorough template stays a five-minute form.',
      },
      {
        heading: 'Signatures and publishing',
        steps: [
          'Add signature slots for the roles that must sign — conductor, supervisor, witness — each slot named for who signs it.',
          'Publish the template. Publishing freezes this version; inspections started from it will reference it forever.',
          'To change a published template later, edit and publish again — that creates the next version. Inspections already underway keep the version they started on.',
        ],
        note: 'Version history is what makes an old inspection defensible: you can always show exactly which questions were asked on the day.',
      },
    ],
  },
  {
    slug: 'conduct-an-inspection',
    title: 'Conduct an inspection',
    area: 'inspections',
    summary:
      'Run a checklist on a phone or laptop, flag what fails, raise actions from the finding, and sign it off.',
    minutes: 6,
    sections: [
      {
        heading: 'Start it',
        steps: [
          'Open Inspections and start a new inspection from a published template — or open one that was scheduled for you from your “For me” queue.',
          'The inspection pins the template version it started from and stamps its own document number automatically.',
        ],
      },
      {
        heading: 'Work through it',
        steps: [
          'Answer as you walk. Progress saves as you go — a phone call, a dead battery or a shift change does not lose the half you finished.',
          'Attach photos where a picture says it better; take them in the moment, from the device you are holding.',
          'Questions revealed by logic appear as your earlier answers trigger them — the form only asks what applies.',
        ],
        tip: 'You can leave an inspection part-finished and return to it from the register; it keeps its state until you submit.',
      },
      {
        heading: 'Flag failures and raise actions',
        steps: [
          'Flag the responses that need follow-up.',
          'Raise a corrective action from the question itself — the action carries the context of exactly which check failed, at which site.',
          'Assign an owner and a due date now, while the finding is in front of you.',
        ],
        note: 'On recurring inspections, actions de-duplicate: the same broken door found four weeks running stays one action, not four.',
      },
      {
        heading: 'Sign and submit',
        steps: [
          'Fill the signature slots the template defined — each slot records who signed and when.',
          'Submit. If the template routes through approval, it lands in the approvals queue; otherwise it is complete.',
          'The finished report is ready to export or share the moment it is submitted.',
        ],
      },
    ],
  },
  {
    slug: 'schedule-recurring-inspections',
    title: 'Schedule recurring inspections',
    area: 'inspections',
    summary:
      'Put a checklist on a rhythm — daily, weekly, monthly — with assignees, reminders and a calendar of what is due.',
    minutes: 5,
    sections: [
      {
        heading: 'Create the schedule',
        steps: [
          'Open Inspections → Schedules and create a new schedule.',
          'Pick the template, the recurrence — daily, weekly, monthly, or a custom rule — and when it starts.',
          'Assign the people who conduct it. Each assignee gets their own occurrence to complete.',
        ],
      },
      {
        heading: 'What happens on its own',
        bullets: [
          'Upcoming occurrences materialise ahead of time and appear on each assignee’s queue and the schedules calendar.',
          'Reminder emails go out before the due date — once per occurrence, not a drumbeat.',
          'Completing the inspection ties it back to the occurrence, so the schedule knows what was done and what was missed.',
        ],
      },
      {
        heading: 'Keep schedules honest',
        steps: [
          'Pause a schedule when the line is down for the summer; resume it when work restarts.',
          'Check the calendar view for pile-ups — forty checks landing on the same Monday morning is a planning problem you can see coming.',
          'Archiving a template pauses its schedules automatically, so a retired checklist never keeps generating work.',
        ],
        tip: 'Schedule to the person who actually walks the route. A schedule assigned to a manager “to sort out later” is a missed check with extra steps.',
      },
    ],
  },
  {
    slug: 'approve-and-share-reports',
    title: 'Approve inspections and share the report',
    area: 'inspections',
    summary:
      'Run the approval step where your process needs one, then get the report to the people who asked for it — PDF, Word, CSV or a link.',
    minutes: 4,
    sections: [
      {
        heading: 'Approve or reject',
        steps: [
          'Open Approvals — submitted inspections wait there, with a count in the navigation.',
          'Review the answers, photos and signatures, then approve — or reject with the reason.',
          'Every decision is logged on the inspection, with who decided and when.',
        ],
      },
      {
        heading: 'Export the report',
        bullets: [
          'PDF — the polished report for clients, auditors and the file.',
          'Word — when the recipient insists on editing the layout themselves.',
          'CSV — the register in rows, for the person who lives in spreadsheets.',
        ],
      },
      {
        heading: 'Share without creating accounts',
        steps: [
          'Create a share link from the inspection — it opens the report for anyone holding the link, no account needed.',
          'Send it to the client, landlord or insurer who asked.',
          'Revoke the link when it should stop working; revocation is immediate.',
        ],
        note: 'Share links are unlisted and revocable — the practical middle ground between “email a PDF forever” and “make them register”.',
      },
    ],
  },

  // ─── Hazards & observations ────────────────────────────────────────────────
  {
    slug: 'set-up-hazard-reporting',
    title: 'Set up hazard reporting and QR codes',
    area: 'observations',
    summary:
      'Categories with their own forms and alerts, plus printed QR codes so anyone can report without an account.',
    minutes: 6,
    sections: [
      {
        heading: 'Shape your categories',
        steps: [
          'Open Hazards & observations → Categories. Sensible defaults exist already — including good practice, so the register is not only ever bad news.',
          'Rename, add or retire categories to match how your organisation actually speaks — “near miss”, “unsafe condition”, “housekeeping”.',
          'Give a category its own custom fields and questions where its reports need different facts — a vehicle-damage report asks different things than a near miss.',
        ],
      },
      {
        heading: 'Wire up the alerts',
        steps: [
          'On each category, choose who is notified when a report arrives.',
          'Set the critical-alert recipients — the shorter list of people who should hear immediately when a reporter marks something critical.',
          'Optionally link inspection templates to a category, so a report can flow straight into a structured follow-up inspection.',
        ],
        tip: 'Keep the critical list short and senior. If everything alerts everyone, nothing alerts anyone.',
      },
      {
        heading: 'Print and place the QR codes',
        steps: [
          'Open Hazards & observations → QR codes and generate codes for the categories and sites you want reportable from the floor.',
          'Print them and put them where the work happens — the canteen board, the loading dock, the plant room door.',
          'Scan one yourself: the public form opens in the phone’s browser, no app and no login, and the report lands in the register tagged with the right category and site.',
        ],
        note: 'Reporters through a QR code can stay anonymous. An imperfect anonymous report beats a perfect report nobody files.',
      },
    ],
  },
  {
    slug: 'handle-a-hazard-report',
    title: 'Handle a hazard report',
    area: 'observations',
    summary:
      'From “someone reported something” to a closed loop — triage, assign, act, and escalate the ones that turn out to be serious.',
    minutes: 5,
    sections: [
      {
        heading: 'Triage what came in',
        steps: [
          'Open Hazards & observations — new reports sit in the register with their category, site, photos and any custom answers.',
          'Read it, then set the priority, the owner and a due date. An unowned report is a report waiting to be forgotten.',
          'Use comments to ask the reporter or colleagues for what is missing — the discussion stays on the record instead of in a group chat.',
        ],
      },
      {
        heading: 'Turn it into work',
        steps: [
          'Raise corrective actions from the report for the fixes it needs — each with its own owner and due date, tracked on the actions board.',
          'If the category links an inspection template, start the follow-up inspection from the report to check the wider area properly.',
        ],
      },
      {
        heading: 'Escalate when it is more than an observation',
        steps: [
          'If what was reported is actually an incident — someone was hurt, something was destroyed — promote the observation to an incident.',
          'Photos and context carry across, and the two records link both ways: the observation shows what it became; the incident shows where it started.',
        ],
        note: 'Promotion is one move, not a retype. The reporter’s original words survive as evidence of what was known, when.',
      },
    ],
  },

  // ─── Incidents ─────────────────────────────────────────────────────────────
  {
    slug: 'record-an-incident',
    title: 'Record an incident',
    area: 'incidents',
    summary:
      'Capture what happened while it is fresh — people, injuries, evidence — with a form built for a phone at the scene.',
    minutes: 6,
    sections: [
      {
        heading: 'Report it fast',
        steps: [
          'Open Incidents → Report — the form is mobile-first, built for the first ten minutes after the event.',
          'Pick the kind — injury, near miss, dangerous occurrence, ill health, property damage and more. The form asks the details that kind needs, nothing else.',
          'Describe what happened, where and when. If the connection drops, your draft survives on the device until you can submit.',
        ],
        tip: 'Report first, perfect later. Every fact can be corrected on the record afterwards — with the correction logged — but the scene only exists once.',
      },
      {
        heading: 'People and injuries',
        steps: [
          'Add each person involved, their role, and the injury details where someone was hurt.',
          'Record absences as they happen — the lost-time calculator watches them, and an absence crossing seven days automatically re-opens the RIDDOR question.',
        ],
        note: 'Sensitive kinds — sharps, violence & aggression — default to confidential: they appear in every count, but their contents are readable only by the people who should. That confidentiality is enforced everywhere, including search, exports and the AI assistant.',
      },
      {
        heading: 'Evidence and severity',
        steps: [
          'Attach photos, documents and witness accounts from the scene — evidence is append-only, so nothing quietly disappears later.',
          'Give your honest read of severity. It is provisional — triage will confirm it — but it drives who gets alerted right now.',
        ],
        bullets: [
          'Site-scoped managers are alerted automatically when the report lands.',
          'The incident starts a timeline that every later step — triage, screening, investigation — writes into.',
        ],
      },
    ],
  },
  {
    slug: 'screen-for-riddor',
    title: 'Screen an incident for RIDDOR',
    area: 'incidents',
    summary:
      'A guided screen for the reportability decision, with the statutory clocks tracked and chased for you.',
    minutes: 5,
    sections: [
      {
        heading: 'Run the guided screen',
        steps: [
          'From the incident, open the RIDDOR screening.',
          'Answer the guided questions — they walk the reportable categories against the recorded facts: the injury, the person, the event.',
          'Record the determination. “Not reportable” is a determination too — dated, reasoned and kept, which is exactly what you want to show an inspector.',
        ],
      },
      {
        heading: 'When it is reportable',
        bullets: [
          'The statutory deadline — 10 or 15 days, depending on the route — is computed and tracked from the incident facts.',
          'Warnings land ahead of the deadline, and it escalates once a deadline passes. The clock is checked every 15 minutes, not once a night.',
          'When you submit the report to the HSE, record the submission — that freezes the determination against later edits.',
        ],
      },
      {
        heading: 'The tripwires that reopen the question',
        bullets: [
          'An absence crossing seven days triggers an automatic re-screen — the over-7-day rule is watched, not remembered.',
          'The incident cannot be closed while a RIDDOR determination is outstanding or undischarged.',
        ],
        note: 'The platform guides the screening and holds the deadlines, but the determination is yours — it structures the judgement rather than replacing it.',
      },
    ],
  },
  {
    slug: 'run-an-investigation',
    title: 'Run and sign off an investigation',
    area: 'incidents',
    summary:
      'A versioned investigation with findings that become actions — approved by someone who did not write it.',
    minutes: 7,
    sections: [
      {
        heading: 'Open the investigation',
        steps: [
          'From the incident, start the investigation and assign the lead.',
          'The investigation level is enforced against the incident’s severity — a serious event cannot quietly get the light-touch treatment.',
          'Gather the account: sequence of events, evidence, witness statements. Everything attaches to the investigation record.',
        ],
      },
      {
        heading: 'Findings and causes',
        steps: [
          'Record findings with their root causes — what failed, why it failed, what would stop it failing again.',
          'For each finding, name the corrective action it needs: what must change, who should own it.',
        ],
        tip: 'Write findings someone can act on. “Improve safety culture” is a wish; “guard the infeed rollers and add the check to the weekly walk” is a finding.',
      },
      {
        heading: 'Submit for separated sign-off',
        steps: [
          'Submit the investigation for approval. The approver cannot be the person who led or submitted it — separation of duty is enforced, not encouraged.',
          'At approval, every finding’s action gets a confirmed owner and due date — approval is the moment the fixes become real work.',
          'Approved revisions freeze. Reopening an investigation writes revision two; it never edits what was approved.',
        ],
        note: 'Where no independent approver exists — a genuinely sole-manager operation — an override is possible, with a justification that goes on the record.',
      },
      {
        heading: 'Close the loop, then check it held',
        steps: [
          'The incident moves to actions-outstanding until the corrective actions are done, then closes.',
          'About 90 days on, an effectiveness review asks the only question that matters: did the fix work?',
          '“Not effective” reopens the incident rather than filing it — a fix that did not hold is not a closed incident.',
        ],
      },
    ],
  },

  // ─── Permits to work ───────────────────────────────────────────────────────
  {
    slug: 'configure-permit-types',
    title: 'Configure your permit types',
    area: 'permits',
    summary:
      'Nine ready-made permit types, each editable — requirements, gas limits and the rules the issue gate enforces.',
    minutes: 5,
    sections: [
      {
        heading: 'Start from the nine seeded types',
        bullets: [
          'Hot work, confined space, working at height, electrical, excavation and more arrive ready to use — each with the checks that kind of work demands.',
          'Open Permits → Types to see what each type requires: preconditions, isolation certificate, rescue plan, gas tests, linked risk assessment.',
        ],
      },
      {
        heading: 'Tune a type to your operation',
        steps: [
          'Edit a type to match your rules — which preconditions must be confirmed, whether an isolation certificate or rescue plan is mandatory, whether a linked risk assessment is required.',
          'Set the gas limits for types that test the atmosphere — the gases, the acceptable ranges, and how fresh a reading must be at issue.',
          'Require a RAMS pack on types where method statements are non-negotiable — the permit will then demand an issued pack or an accepted contractor review.',
        ],
        note: 'Limits refuse impossible numbers, never bad news: a reading outside physical bounds is rejected as a typo; a reading inside bounds but over your limit is recorded and fails the gate — exactly as it should.',
      },
      {
        heading: 'Add your own types',
        steps: [
          'Create a new type for work the seeded nine do not cover — pressure testing, lone working in a specific plant, whatever your operation authorises formally.',
          'Give it the same treatment: its preconditions, its documents, its limits.',
        ],
        tip: 'A permit type is your rulebook made executable. If the paper permit had a box, the type should have a requirement — otherwise the gate cannot hold it.',
      },
    ],
  },
  {
    slug: 'issue-a-permit',
    title: 'Raise and issue a permit',
    area: 'permits',
    summary:
      'From “we need to do hot work” to an issued permit — with every check the type demands verified at the gate.',
    minutes: 7,
    sections: [
      {
        heading: 'Raise it',
        steps: [
          'Open Permits and create a new permit; pick the type and the site.',
          'Describe the work, the location and the validity window — when it may start and when it lapses.',
          'Work through what the type demands: confirm preconditions, attach the isolation certificate, record the rescue plan, link the risk assessment or RAMS pack.',
        ],
      },
      {
        heading: 'Record the gas tests',
        steps: [
          'Enter the readings for each gas the type tests, with the time they were taken.',
          'Each reading gets its own verdict against the type’s limits, snapshotted onto the permit — the numbers you issued on are the numbers the record keeps.',
        ],
        note: 'Stale readings fail the gate. A reading in range at 6am does not authorise entry at noon; the freshness rule is the type’s to set and the gate’s to enforce.',
      },
      {
        heading: 'Clear the conflicts, then issue',
        steps: [
          'If other permits overlap the same place — welding above a confined-space entry — the clash is shown and must be explicitly acknowledged, by a person, on the record.',
          'The authoriser counter-signs and issues. If anything the type requires is missing, the gate refuses with the reason — fix it and issue again.',
        ],
        tip: 'The gate refusing is the system working. Every refusal message names the missing thing; an issued permit means all of them existed at issue time.',
      },
      {
        heading: 'Acceptance',
        steps: [
          'The person doing the work accepts the permit within its validity window — acceptance after the window has lapsed is refused.',
          'A contractor without an account can be named as acceptor and sign on the issuer’s device, counter-signed by a permit holder — because naming an internal colleague who is not doing the work is legally wrong.',
        ],
      },
    ],
  },
  {
    slug: 'run-permits-day-to-day',
    title: 'Run permits through the day',
    area: 'permits',
    summary:
      'The live board, entry logs, extensions, handovers and closure — the operational side of permit control.',
    minutes: 6,
    sections: [
      {
        heading: 'Watch the board',
        bullets: [
          'Permits → Board shows every open permit: status, site, type and clock, at a glance.',
          'It is the 8am answer to “what high-risk work is running right now?” — and the 4pm answer to “what should have closed by now?”.',
        ],
      },
      {
        heading: 'Log entries and exits',
        steps: [
          'For confined-space work, log every entry and exit against the permit as they happen.',
          'The permit always knows who is inside — and refuses to close while anyone still is.',
        ],
      },
      {
        heading: 'Extend and hand over properly',
        steps: [
          'Extending a permit re-checks the clashes — the welding that was fine this morning may not be fine now that another crew started downstairs.',
          'Resuming suspended work needs a real attestation and a fresh, in-range gas re-test — not a nod.',
          'Handover transfers the permit to a new acceptor; it can never target the authoriser, because the person who authorised the work cannot also be the person doing it.',
        ],
      },
      {
        heading: 'Expiry and closure',
        bullets: [
          'An hour before expiry, the people responsible are warned; once a permit lapses without closure, it escalates. The watch runs every 15 minutes.',
          'Closure records the end of the work; the permit PDF — signed, timestamped in the site’s own timezone — is ready for the job file.',
        ],
        tip: 'Treat the expiry warning as a planning tool: extend deliberately before the window lapses, rather than explaining afterwards why work continued on a dead permit.',
      },
    ],
  },

  // ─── Actions ───────────────────────────────────────────────────────────────
  {
    slug: 'create-and-assign-actions',
    title: 'Create and assign actions',
    area: 'actions',
    summary:
      'Raise work from findings or from scratch, with the owner, due date and type that make it real.',
    minutes: 4,
    sections: [
      {
        heading: 'Raise actions where the finding is',
        bullets: [
          'From a failed inspection response — the action carries the exact question and inspection it came from.',
          'From a hazard report — the fix for what was reported.',
          'From an approved incident finding — created exactly once, with owner and due date confirmed at approval.',
          'From a failed fire-safety check — raised by default when a check fails.',
          'Or standalone, from the Actions register, for work that starts as work.',
        ],
      },
      {
        heading: 'Make it assignable',
        steps: [
          'Give every action an owner — one person, not a team. Shared ownership is how actions rot.',
          'Set a due date and a priority the owner can defend.',
          'Pick the type — corrective, preventive, improvement or maintenance by default; your own types and categories under Settings → Actions.',
        ],
        tip: 'A good action reads as an instruction: what to do, where, by when. “Investigate options” is a meeting, not an action.',
      },
      {
        heading: 'Close with evidence',
        steps: [
          'The owner attaches photos or files showing what was done — the fixed guard, the new signage, the invoice.',
          'Closing writes the completion onto the record, and the source — inspection, report, incident — reads it back.',
        ],
      },
    ],
  },
  {
    slug: 'keep-on-top-of-actions',
    title: 'Keep on top of the actions board',
    area: 'actions',
    summary:
      'The filters, queues and counts that keep a hundred open actions honest — without a weekly chase meeting.',
    minutes: 4,
    sections: [
      {
        heading: 'Everyone clears their own queue',
        bullets: [
          '“For me” shows each person the actions they owe, beside the signatures and acknowledgements waiting on them.',
          'Owners are chased automatically: one daily email covering everything they owe, and silence when they owe nothing.',
        ],
      },
      {
        heading: 'Managers work the register',
        steps: [
          'Open Actions and lean on the filters: overdue, by site, by source, by assignee, by type.',
          'The needs-attention count in the navigation is the number that matters — navigate to the red, deal with it, watch it fall.',
          'Reassign and re-date where reality has moved — an action nobody believes in is worse than an honest extension.',
        ],
        tip: 'Review overdue actions by owner, not by list order. Five overdue actions usually belong to two people, and that is a different conversation.',
      },
      {
        heading: 'Report when asked',
        steps: [
          'Export the filtered register to CSV when the board or the client wants the numbers.',
          'For a live view, the analytics side can chart actions by status, site and time — drilling back into this same register.',
        ],
      },
    ],
  },
];
