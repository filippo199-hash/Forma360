/**
 * briefing-writer — turns a topic (or one of the tenant's RAMS packs)
 * into a ready-to-review briefing / toolbox talk, saved as a DRAFT
 * heads-up. Apply (client-side, `briefings/page.tsx`) maps the proposal
 * onto the ordinary `headsUps.create` mutation, which ALWAYS inserts
 * `status: 'draft'` — publish is a separate `headsUps.publish` call this
 * agent never makes, so recipients, scheduling and the actual send stay
 * entirely with the human.
 *
 * Recipient grounding: the context lists the tenant's groups and sites
 * by id; the proposal may only suggest ids from those lists, and the
 * Apply side re-checks against live `groups.list` / `sites.list` data,
 * dropping (never erroring on) any id it cannot verify — a hallucinated
 * ULID must not reach the draft's recipientSpec.
 *
 * RAMS grounding is double-gated HERE, not just in the UI: the pack
 * list and the packId anchor's frozen snapshot are only fetched when
 * `brandHasModule(brand, 'rams')` AND the caller holds `rams.view` — a
 * Forma360 tenant or a non-rams user never sees pack titles in the
 * prompt, whatever params the client sends.
 */
import type Anthropic from '@anthropic-ai/sdk';
import {
  groups,
  ramsPacks,
  ramsPackVersions,
  sites,
  type RamsPackVersionContent,
} from '@forma360/db/schema';
import { brandHasModule } from '@forma360/shared/brand';
import { hasPermission, loadUserPermissions } from '@forma360/permissions/requirePermission';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { activeBrand } from '../../lib/brand';
import type { TaskAgentServerDef } from './index';

/** ~10k tokens of serialised context; clip long fields before exceeding it. */
const MAX_CONTEXT_CHARS = 40_000;
/** Budget for the anchored pack's frozen snapshot inside that context. */
const MAX_SNAPSHOT_CHARS = 20_000;
/** Groups / sites offered as recipient suggestions. */
const LIST_CAP = 100;
/** Recent RAMS packs offered for grounding. */
const PACK_LIST_CAP = 25;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Body cap is deliberately BELOW headsUps.createInput's 50,000-char
// description limit, so a runaway draft fails in the model-facing
// correction loop rather than at Apply.
const proposalSchema = z.object({
  /** Plain-English decision summary — every agent proposal carries one. */
  summary: z.string().min(1).max(2000),
  title: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(40_000),
  engagementLevel: z.enum(['view', 'acknowledge', 'sign']),
  /**
   * Relative days, NEVER an ISO date — the client computes `expiresAt`
   * at Apply, so the model does no date arithmetic.
   */
  suggestedExpiryDays: z.number().int().min(1).max(365).optional(),
  /** Ids from the context lists only; unknown ids are dropped at Apply. */
  recipientGroupIds: z.array(z.string().length(26)).max(10).default([]),
  recipientSiteIds: z.array(z.string().length(26)).max(10).default([]),
  /** One-line rationale (e.g. why 'sign' was chosen). */
  note: z.string().trim().max(500).optional(),
});

export type BriefingWriterProposal = z.infer<typeof proposalSchema>;

const proposeTool: Anthropic.Tool = {
  name: 'proposeBriefing',
  description:
    'Propose a complete DRAFT briefing / toolbox talk. Call this in the same turn you decide the brief is workable. The manager reviews the draft in the briefing editor, picks recipients and publishes it themselves — nothing is sent, signed or published by this call.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          '2-4 plain-English sentences a non-technical manager reads to decide whether to apply: what was drafted, the key assumptions made, and what to double-check. Required.',
      },
      title: {
        type: 'string',
        description: 'Short briefing title as it appears in the register. Max 500 chars.',
      },
      body: {
        type: 'string',
        description:
          'The full briefing text with markdown-style headed sections, written to be read aloud to a crew. Max 40000 chars — but match the configured length; never pad.',
      },
      engagementLevel: {
        type: 'string',
        enum: ['view', 'acknowledge', 'sign'],
        description:
          "What recipients must do: 'view' (just read), 'acknowledge' (confirm they read it), 'sign' (signature collected — safety-critical instruction where proof someone was told matters).",
      },
      suggestedExpiryDays: {
        type: 'integer',
        minimum: 1,
        maximum: 365,
        description:
          'Days from now until the briefing expires. ONLY for time-bounded content (a weather warning, a temporary works phase); omit for standing guidance. Relative days only — never a date.',
      },
      recipientGroupIds: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string' },
        description:
          'Group ids from the context list ONLY, matching what the brief says about the audience. If unsure, suggest none — the manager picks at publish time.',
      },
      recipientSiteIds: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string' },
        description: 'Site ids from the context list ONLY. If unsure, suggest none.',
      },
      note: {
        type: 'string',
        description:
          "One-line rationale shown to the manager (e.g. why 'sign' was chosen over the default). Max 500 chars.",
      },
    },
    required: ['summary', 'title', 'body', 'engagementLevel'],
  },
};

const basePrompt = `You are a briefing writer for ${activeBrand.name}, helping an HSE manager prepare a briefing or toolbox talk for their workforce. You write in British English using UK HSE terminology (e.g. "risk assessment", "method statement", "PPE", "banksman", "permit to work", "RIDDOR", "competent person"). Keep language plain and site-ready: short sentences, everyday words, readable aloud to a work crew in a few minutes.

What you produce: a DRAFT briefing only. You never publish, send, sign or collect signatures — the manager reviews your draft, chooses recipients and publishes it themselves. Never claim the briefing has been sent, published or that anyone has been notified. Never invent statistics, incident details, legal citations or dates; if a regulation is relevant, name it in general terms ("under COSHH regulations") and phrase everything as practical guidance to verify, never as legal advice.

Use the organisation knowledge below whenever it is relevant: site rules, company terminology, known hazards and named procedures from the knowledge take precedence over generic content. If a RAMS pack snapshot is provided in the context, the briefing must be grounded in it: cover its key hazards and the controls that protect against them, the sequence of work at a headline level, required PPE, and any hold points — written as a talk, not a restatement of the document. Do not introduce hazards or controls that are not in the pack or the knowledge unless they are universally applicable (e.g. housekeeping, stop-work authority).

How you work:
1. Read the manager's brief. If it is detailed enough to write something useful, draft immediately — do not interrogate. Only when the brief is genuinely too thin (e.g. just "toolbox talk"), ask AT MOST 2-3 short clarifying questions, all together in ONE message — good ones: the topic or activity, who the audience is, anything site-specific to include. Never ask a second round.
2. When you are ready, call the proposeBriefing tool IN THE SAME turn. You may write one short sentence first ("Drafting that now…"), but never end a turn promising to draft without calling the tool.

When you draft (the proposeBriefing call):
- Structure the body with clear headed sections, typically: why this matters (one or two lines), the key points or hazards and their controls, do's and don'ts, what to do if something goes wrong / who to report to, and one or two questions to ask the crew to check understanding.
- Length: unless a briefing-length setting below says otherwise, write a 5-minute talk (roughly 350-600 words). Never pad.
- engagementLevel: use 'acknowledge' as the working default, escalating to 'sign' only for safety-critical instruction where proof someone was told matters, and dropping to 'view' only for routine notices. If a setting below states a different default, use that instead. Say in the note field why, if you deviated from the default.
- Suggest recipient groups or sites ONLY from the id lists provided in the context, using the exact ids in recipientGroupIds / recipientSiteIds, matching by what the brief says about the audience; if unsure, suggest none — the manager picks at publish time.
- Suggest suggestedExpiryDays only when the content is time-bounded (a weather warning, a temporary works phase); leave it unset for standing guidance. Always relative days, never a date.
- Every call MUST include a "summary" field: 2-4 plain-English sentences a non-technical manager reads to decide whether to apply — what was drafted, the key assumptions you made, and what they should double-check.

Be warm and efficient. Do not narrate what the tool does; write the draft, propose it, and stop.`;

function settingsBlock(settings: Record<string, string>): string {
  // Catalogue entry for briefing-writer carries the shared "detail" dial
  // plus a reading-level dial; the defaults ('standard' / 'everyday')
  // add no prompt line — the basePrompt already states that behaviour.
  const lines: string[] = [];
  const detail = settings['detail'];
  if (detail === 'concise') {
    lines.push(
      'Briefing length: concise — a 2-minute shift-start read (roughly 150-250 words); headline points only, no preamble.',
    );
  } else if (detail === 'thorough') {
    lines.push(
      'Briefing length: thorough — a full toolbox talk towards the upper end of 350-600 words, with every hazard-and-control pairing spelled out and the check-understanding questions included.',
    );
  }
  const readingLevel = settings['readingLevel'];
  if (readingLevel === 'simple') {
    lines.push(
      'Reading level: simple — very plain wording and short sentences, suitable where English may be a second language; avoid jargon and expand any abbreviation on first use.',
    );
  } else if (readingLevel === 'technical') {
    lines.push(
      'Reading level: technical — the audience are competent trades; use correct technical and regulatory terminology without over-explaining it.',
    );
  }
  return lines.join('\n');
}

/**
 * Serialise the frozen pack-version snapshot (ADR 0007) into a labelled
 * text block — the same content the briefing screen and pack PDF render,
 * so the talk is grounded in "the pack as issued", never a mutable row.
 */
function packSnapshotText(
  referenceNumber: string | null,
  versionNumber: number,
  content: RamsPackVersionContent,
): string {
  const lines: string[] = [];
  const job = content.jobContext;
  lines.push(
    `Pack: ${referenceNumber ?? '—'} "${clip(job.title, 200)}" (issued version ${versionNumber})`,
  );
  if (job.clientName.length > 0) lines.push(`Client: ${clip(job.clientName, 200)}`);
  if (job.siteName !== null) {
    lines.push(
      `Site: ${clip(job.siteName, 200)}${
        job.locationText.length > 0 ? ` (${clip(job.locationText, 200)})` : ''
      }`,
    );
  }
  if (job.plannedFrom !== null || job.plannedTo !== null) {
    lines.push(`Planned dates: ${job.plannedFrom ?? '—'} to ${job.plannedTo ?? '—'}`);
  }
  if (content.content.scopeOfWorks.length > 0) {
    lines.push(`Scope of works: ${clip(content.content.scopeOfWorks, 1500)}`);
  }
  for (const step of content.content.steps) {
    const ppe = [...step.ppe, ...(step.ppeOther.length > 0 ? [step.ppeOther] : [])];
    lines.push(
      `Step ${step.sequence}: ${clip(step.title, 200)} — ${clip(step.description, 600)}${
        step.controlNotes.length > 0 ? ` | Controls: ${clip(step.controlNotes, 300)}` : ''
      }${ppe.length > 0 ? ` | PPE: ${clip(ppe.join(', '), 200)}` : ''}${
        step.holdPoint !== null
          ? ` | HOLD POINT (${step.holdPoint.kind}): ${clip(step.holdPoint.description, 300)}`
          : ''
      }`,
    );
  }
  for (const ra of content.riskAssessments) {
    lines.push(
      `Risk assessment: ${ra.referenceNumber ?? '—'} "${clip(ra.title, 200)}" v${ra.versionNumber} (worst residual band: ${ra.worstResidualBand})`,
    );
    // Absent on packs issued before RS-A6 — the summary row still stands.
    for (const hazard of ra.hazards ?? []) {
      lines.push(
        `  Hazard: ${clip(hazard.hazard, 300)} | Who: ${clip(hazard.whoAffected, 200)} | Controls: ${clip(hazard.controls, 400)} | Residual: ${hazard.residualBand}`,
      );
    }
  }
  for (const sub of content.coshh) {
    lines.push(
      `COSHH substance: ${clip(sub.substanceName, 200)} (${sub.referenceNumber ?? '—'}) — ${clip(sub.taskDescription, 300)}`,
    );
  }
  const emergency = content.content.emergency;
  if (emergency.firstAid.length > 0) lines.push(`First aid: ${clip(emergency.firstAid, 500)}`);
  if (emergency.emergencyProcedure.length > 0) {
    lines.push(`Emergency procedure: ${clip(emergency.emergencyProcedure, 500)}`);
  }

  let out = lines.join('\n');
  if (out.length > MAX_SNAPSHOT_CHARS) out = `${out.slice(0, MAX_SNAPSHOT_CHARS)}…`;
  return out;
}

export const briefingWriter: TaskAgentServerDef = {
  agentId: 'briefing-writer',

  basePrompt,

  proposeTool,

  parseProposal: (input) => proposalSchema.parse(input),

  settingsBlock,

  // No required anchor: the register page opens the panel bare and the
  // groups/sites recipient vocabulary is always useful. `packId` is an
  // optional deep-link anchor; when it is absent, unknown, or the caller
  // fails the rams double-gate, the pack sections simply do not appear.
  // Every query is tenant-scoped.
  buildContext: async ({ db, tenantId, userId, params }) => {
    const parts: string[] = [];

    const groupRows = await db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), isNull(groups.archivedAt)))
      .orderBy(asc(groups.name))
      .limit(LIST_CAP);
    parts.push(
      groupRows.length > 0
        ? `### Recipient groups you may suggest (use the exact id; ONLY these)\n${groupRows
            .map((g) => `${g.id} — ${clip(g.name, 200)}`)
            .join('\n')}`
        : '### Recipient groups\nThis organisation has no groups — suggest no recipientGroupIds.',
    );

    const siteRows = await db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), isNull(sites.archivedAt)))
      .orderBy(asc(sites.name))
      .limit(LIST_CAP);
    parts.push(
      siteRows.length > 0
        ? `### Recipient sites you may suggest (use the exact id; ONLY these)\n${siteRows
            .map((s) => `${s.id} — ${clip(s.name, 200)}`)
            .join('\n')}`
        : '### Recipient sites\nThis organisation has no sites — suggest no recipientSiteIds.',
    );

    // RAMS grounding is double-gated at this layer, not just in the UI:
    // brand module AND the caller's own rams.view. A packId param from a
    // caller failing either gate is ignored, so no pack title ever
    // reaches the prompt for them.
    let ramsAllowed = false;
    if (brandHasModule(activeBrand.id, 'rams')) {
      const perms = await loadUserPermissions(db, tenantId, userId);
      ramsAllowed = hasPermission(perms, 'rams.view');
    }

    if (ramsAllowed) {
      const packRows = await db
        .select({
          id: ramsPacks.id,
          referenceNumber: ramsPacks.referenceNumber,
          title: ramsPacks.title,
          status: ramsPacks.status,
          currentVersion: ramsPacks.currentVersion,
        })
        .from(ramsPacks)
        .where(and(eq(ramsPacks.tenantId, tenantId), isNull(ramsPacks.archivedAt)))
        .orderBy(desc(ramsPacks.updatedAt))
        .limit(PACK_LIST_CAP);
      // Issued first; Array.prototype.sort is stable, so recency order
      // survives within each class.
      const ordered = [...packRows].sort(
        (a, b) => Number(b.status === 'issued') - Number(a.status === 'issued'),
      );
      if (ordered.length > 0) {
        parts.push(
          `### Recent RAMS packs (for reference — a briefing can be grounded in one)\n${ordered
            .map(
              (p) =>
                `${p.referenceNumber ?? '—'} "${clip(p.title, 200)}" — status: ${p.status}${
                  p.currentVersion > 0 ? `, issued version ${p.currentVersion}` : ''
                }`,
            )
            .join('\n')}`,
        );
      }

      const packId = params['packId'];
      if (packId !== undefined && packId.length === 26) {
        const [pack] = await db
          .select({
            id: ramsPacks.id,
            referenceNumber: ramsPacks.referenceNumber,
            title: ramsPacks.title,
            status: ramsPacks.status,
          })
          .from(ramsPacks)
          .where(and(eq(ramsPacks.tenantId, tenantId), eq(ramsPacks.id, packId)))
          .limit(1);
        if (pack !== undefined) {
          // The latest frozen version (ADR 0007) — never the mutable
          // draftContent, so the talk describes the pack as issued.
          const [version] = await db
            .select({
              versionNumber: ramsPackVersions.versionNumber,
              content: ramsPackVersions.content,
            })
            .from(ramsPackVersions)
            .where(
              and(eq(ramsPackVersions.tenantId, tenantId), eq(ramsPackVersions.packId, pack.id)),
            )
            .orderBy(desc(ramsPackVersions.versionNumber))
            .limit(1);
          if (version !== undefined) {
            parts.push(
              `### CONTEXT — the RAMS pack this briefing is grounded in (frozen as issued)\n${packSnapshotText(pack.referenceNumber, version.versionNumber, version.content)}`,
            );
          } else {
            parts.push(
              `### CONTEXT — selected RAMS pack\n${pack.referenceNumber ?? '—'} "${clip(pack.title, 200)}" has never been issued, so there is no frozen content to ground the briefing in. Draft from the manager's brief and remind them plainly that this pack is not yet in force and the briefing must be checked against it once issued.`,
            );
          }
        }
      }
    }

    let out = parts.join('\n\n');
    if (out.length > MAX_CONTEXT_CHARS) out = `${out.slice(0, MAX_CONTEXT_CHARS)}…`;
    return out;
  },
};
