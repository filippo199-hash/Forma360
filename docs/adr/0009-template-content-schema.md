# ADR 0009 — Template content schema

**Status:** Accepted
**Date:** 2026-04-19

## Context

Phase 2 stores a template's authored structure (pages, sections,
questions, logic, tables, signature slots, approval page, settings) as
a single JSONB column on `template_versions.content`. This shape is
read by every downstream surface:

- The template editor (both reads and writes via optimistic saves).
- The inspection conduct runtime (reads the pinned version).
- The PDF / Word renderers (iterate every page + section).
- The rule evaluator when computing dynamic visibility (logic).
- Analytics / compliance (Phase 7+, reads historical versions).
- JSON export / import (the Phase 2 surrogate for the deferred
  Public Library).

**Immutability** (locked in by ADR 0007 and the Phase 2 prompt) means
published versions never change. Every edit produces a new draft row;
publish flips `isCurrent`. So the shape needs to be stable enough that
a 2026 version and a 2029 version can both be read by the same PDF
renderer forever.

We also need a schema that a new engineer can look at once and
understand completely — Phase 4, 5, 8, and 10 modules will read this
JSON without ceremony.

## Decision

### Single versioned JSON shape, Zod-validated at every boundary

`TemplateContent` lives in `packages/shared/src/template-schema.ts` as
a Zod schema. The **root carries its own `schemaVersion`**
(`'1'` for Phase 2). Every import, every export, every DB write goes
through `templateContentSchema.parse(...)`. Malformed imports fail
loudly, not at render time.

### Top-level shape

```ts
{
  schemaVersion: '1',
  title: string,                        // template name is on the row, this is the content-level caption
  description?: string,                 // Markdown
  pages: [
    { id, type: 'title' | 'inspection',
      title, description?,
      sections: [
        { id, title, description?,
          items: Item[] }              // union of question | instruction | table
      ]
    }
  ],
  settings: {
    titleFormat: string,                 // e.g. "{site} – {date} – {docNumber}"
    documentNumberFormat: string,        // e.g. "AUDIT{counter:6}" — width in braces
    documentNumberStart?: integer,       // default 1
    approvalPage?: {
      title: string,
      instructions?: string,
      approverSlots: ApproverSlot[]
    }
  },
  customResponseSets: CustomResponseSet[] // inlined so a version is self-contained
}
```

Global Response Sets are **referenced by id** in question definitions
but their content (label, flagged flag, colour) is **snapshotted into
`customResponseSets`** at publish time. This satisfies T-E17 — editing
a Global Response Set doesn't retroactively mutate in-progress or
completed inspections because the snapshot is frozen in the version.

### Questions are a discriminated union

Every question has `{ id, type, prompt, required?, note?,
visibility? }` plus a per-type payload. The `type` discriminator lets
Zod narrow exhaustively. The 14 `Item` kinds we ship in Phase 2:

| kind | variants |
|---|---|
| Question kinds | `multipleChoice`, `text`, `number`, `date`, `time`, `datetime`, `media`, `annotation`, `signature`, `slider`, `checkbox` |
| Title-page-only question kinds | `site`, `conductedBy`, `inspectionDate`, `documentNumber`, `location`, `asset`, `company` |
| Non-question kinds | `instruction`, `table` |

`table` is itself a discriminated union on `tableKind: 'blank' | 'risk' |
'checklist' | 'inventory'` — the four pre-built shapes the spec
mandates. `blank` carries a column definition; the others start from
the locked pre-set and allow additive customisation.

### Logic is an array of rules on each question

Each question may carry `visibility?: { dependsOn: questionId,
operator: 'equals' | 'notEquals' | 'in' | 'notIn' | 'answered', value? }`
for *conditional show*. The reconcile path evaluates visibility before
applying required-check (T-E08).

Deeper *triggers* (follow-up, require action, require evidence,
require note, send notification) live on the response row inside
`multipleChoice` options:

```ts
{ id, label, color?, flagged?, triggers?: Trigger[] }
```

The 5 trigger kinds are their own discriminated union. Follow-up
triggers reference questions elsewhere in the same section via `id`.
This is what supports the ≤ 40 nested-levels semantics — depth is the
length of the follow-up chain computed at parse time.

### Size-ish limits enforced at the Zod layer

- Tables: ≤ 20 columns per definition, ≤ 100 rows per response
  (response-side cap enforced in the response schema, not here).
- Notifications: ≤ 500 recipient ids per trigger.
- Logic: ≤ 40 nesting levels in follow-up chains — a `superRefine`
  on the root walks every follow-up chain and rejects at 41 deep.
- Signature slots: ≤ 10 per signature field.
- `titleFormat`: declared max length 500 (the title it produces is
  capped at 250 at render time per T-E09).

The limits live in `packages/shared/src/template-schema.ts` as
constants so every consumer reads them from the same place.

### Ids are ULIDs

Every `id` field (page, section, item, response-option, trigger,
signature slot, approver slot) is a ULID generated at create time —
not an auto-increment, not a path. Ids stay stable across edits; the
editor never re-numbers. This is what makes inspection answers
reliably join back to their questions after a template version bump
that only touched wording (T-E13).

## Rationale

1. **One schema, one Zod validator.** A malformed JSON upload dies at
   the boundary with a per-field error, not on the conduct page.
2. **Schema version on the root.** When Phase 10 needs to add
   AI-generated fields we ship a v2 schema + a v1→v2 adapter.
   Historical inspections keep reading v1.
3. **Discriminated union of question types.** TypeScript narrows
   exhaustively inside the PDF renderer, the conduct runtime, and the
   dependent-resolver registry. No `string` typos slip through.
4. **Triggers on response options, not on the question.** Matches the
   spec's "different logic paths for different responses". Also
   simplifies the editor UX — each option row has its own triggers
   sub-panel.
5. **Response-set snapshot into the version.** T-E17 falls out
   automatically: the resolved set lives inside the version's content.
   In-progress inspections read the version's content, so nothing
   retroactively changes.
6. **ULIDs as ids.** Stable joins across edits, human-readable in logs,
   already a Phase 0 primitive.

## Consequences

- **Template JSON export/import** is literally
  `templateContentSchema.parse(JSON.parse(input))`. The JSON we
  produce round-trips into itself.
- **PDF / Word renderers** iterate the parsed tree and switch on
  `item.type`. No custom per-template rendering code path.
- **Inspection responses** are a mirror schema
  (`inspection-response-schema.ts`) keyed by item id. The response
  shape is a separate file because the mirror carries runtime-only
  fields (uploaded-media object keys, signature image keys, timestamps).
- **Migrations of the content shape happen via schema version bumps**,
  not DB migrations. Phase 10 ships `v2` alongside `v1` and keeps both
  parsers available.

## Non-options that were rejected

- **Normalised tables** (pages, sections, questions as separate rows).
  Would simplify queries but kill the atomic-snapshot guarantee — the
  whole point of versioning is "this version is frozen and readable in
  ten years." A tangled FK graph makes that hard. JSONB is the right
  tool here.
- **A separate response-set table with FK from questions.** Loses the
  T-E17 snapshot-on-publish behaviour unless we copy on publish
  anyway — and if we copy on publish anyway, we may as well inline.
- **GraphQL-style field selection on reads.** Overkill — a full
  content blob is small (usually < 50 KB even for the 500-question
  performance test) and getting it in one SELECT is fine at our scale.
- **JSON Schema instead of Zod.** Zod gives us TypeScript types for
  free. Runtime validation + compile-time types from the same source
  is non-negotiable.
