# UX audit — Templates

**Module:** Templates / template editor (`/[locale]/templates` + `/[locale]/templates/[templateId]`)
**Investigated:** 2026-07-25 · live walkthrough on prod (T-Open template) + code review
**Primary code:** `apps/web/src/components/templates/editor-shell.tsx` (top bar + title), `content-tab.tsx` (1864 lines — the build canvas: pages, questions, response-type picker), `item-detail.tsx` (per-question settings), `response-sets-tab.tsx` (response-set catalogue), `packages/shared/src/template-builder.ts` (AI spec → template content), `apps/web/src/server/template-agent.ts` (AI generation prompt), `packages/shared/src/template-spec.ts` (AI spec schema)

---

## How it works today

- The editor has three steps: **Build** (pages + questions), **Settings**, **Visibility**. Build is the `content-tab` canvas.
- Each question row = a **prompt** (left) + a **type of response** (right). Response types are either a **multiple-choice response set** (a shared, reusable option list like "Yes / No / N/A") or a built-in type (Text, Number, Checkbox, Date & time, Media, Slider, Annotation, Signature, **Site**, Location).
- **Response sets are deduplicated**: `template-builder.ts` keeps a signature index so questions that share the exact same options collapse into one shared set (good — avoids clutter). Custom response sets live in `content.customResponseSets` and appear in the response-type picker + the Response-sets tab.
- The **AI generator** (`template-agent.ts`) produces a spec that `template-builder.ts` turns into template content, then dedupes.

**What's good:** the response-type picker is clean, with 5 sensible MC presets + a "Create response set"; the shared-response-set model is the right architecture; the 3-step Build/Settings/Visibility flow is clear; dedup already exists for identical sets.

---

## Findings

### 1. [High] A long template title is clipped and can't be read (your report)
Confirmed live: typing a long title ("Monthly Fire Safety & Emergency Preparedness Inspection — Warehouse District North Zone Facilities") shows only a **fragment** in the big header title — the input scrolls to the caret and the rest is cut off (I saw "…Emergency Prepar" and, with the caret at the end, "Warehouse District North Zone Facilities" with the start gone). The top-bar breadcrumb title is also single-line with `truncate`.

**Root cause:** the header title is a **single-line `<input>`** that never wraps; the top-bar title is `… truncate …` (editor-shell.tsx:200–204).

**Suggestion:** make the big header title a **wrapping, auto-growing textarea** (or a `<div>` that wraps) so the whole title is visible on 1–3 lines; keep the top-bar breadcrumb truncated (with a `title=` tooltip) since space there is genuinely limited.

### 2. [High] A long question prompt is clipped — no multi-line (your report)
Confirmed live: a long question ("Is the fire extinguisher fully charged, unobstructed, mounted at the correct height, and inspected within the last 12 months with a visible tag?") shows only its **tail** ("…hin the last 12 months with a visible tag?") in the row; the start is scrolled out of view.

**Root cause:** the prompt is a **single-line input** in two places — the in-row editor (`content-tab.tsx:1201`, `flex-1 truncate`) and the expanded item editor (`item-detail.tsx:151`, `<Input>`). Notably the *note* field right below is already a multi-line `<Textarea>` — the actual question isn't.

**Suggestion:** swap the prompt input for an **auto-growing `<Textarea>`** (grows with content, wraps, caps at ~4 rows then scrolls) in both the in-row and the item-detail editors, so the full question is always visible while editing. In the row list, allow the prompt to wrap to 2 lines (or `line-clamp-2` with a tooltip) instead of `truncate`.

### 3. [High] AI generation produces duplicate multiple-choice response sets (your report)
Confirmed root cause in code. The dedup index in `template-builder.ts` keys a response set on `JSON.stringify({ multiSelect, options })` where each option's signature **includes its triggers** (`buildMultipleChoice`, lines 118–126: `triggers` are part of `SetOption`). So two questions with the **same Yes/No/N/A scale but different per-question triggers** (e.g. a different `requireAction` title, or one has `requireEvidence` and another doesn't) get **different signatures → separate, duplicate response sets**. The AI is explicitly prompted to keep triggers identical on a repeated scale (`template-agent.ts:35,41`), but the model doesn't always comply — and when it doesn't, the account floods with near-identical "Yes / No / N/A" sets. That's exactly the "duplicate multiple-choice responses that don't make sense."

**Suggestion (the real fix):** make **triggers per-question, not part of the shared set** — mirror how `flaggedOptionIds` and `jumps` are already lifted onto the question (lines 130–133). Then the dedup signature is pure `{label, color}` and every same-scale question collapses into one set regardless of trigger differences. Two ways to get there:
- **Builder-side (fast, high impact):** exclude `triggers` from the dedup signature; attach per-question trigger overrides keyed on the shared option ids (schema already supports per-question projections). Add a post-build merge pass as a safety net that collapses sets with identical `{label,color}` option lists.
- **Schema-side (cleaner long-term):** move `requireAction` / `requireEvidence` / `notify` off the response-set option and onto a per-question `optionOverrides` map.

Either way, add a builder test: "N questions with the same scale but different requireAction titles → one shared response set."

### 4. [Medium] No "Project" response type; "Site" ignores the Sites/Projects terminology (your report)
Confirmed live: the response-type picker's "Other responses" column lists **Site** and Location but **no Project**. Under the hood the conduct-time picker (`sites.listForConductor`, sites.ts:125) has **no `kind` filter**, so it already returns both sites *and* projects — but the type is hard-labeled "Site", there's no distinct **Project** type, and no way to restrict a question to one kind.

**Suggestions:**
- Add a **"Project" response type** alongside "Site" that filters the conduct picker to `kind = 'project'` (and make "Site" filter `kind = 'site'`). This is the direct "tag a project" the report asks for.
- Respect the tenant **terminology setting** on these type labels (Site / Project / "Site or Project"), the same way the rest of the app now does.
- (Optional) instead of two types, a single **"Site / Project"** type with a per-question toggle "allow: sites · projects · both".
- Note the `site`/`asset`/`location`/`company`/`annotation` question types currently render an **amber "stub" notice** in the item editor (`item-detail.tsx:682`) with no per-question configuration — the kind filter would be the first real setting for the Site/Project type.

### 5. [Low] Response-set option labels and list-view prompts truncate
Option chips and the collapsed question rows use `truncate` (`content-tab.tsx:1863`, `:337`), so long option labels ("Compliant / Non-Compliant") or long prompts are clipped in list/preview contexts.

**Suggestion:** `title=` tooltips at minimum; allow 2-line wrap where the layout permits (ties into #2).

### 6. [Low] Duplicate response sets are also easy to create manually
Because the response-type picker lists every custom set, a template with AI-generated (or hand-made) near-duplicates shows a cluttered list of "Yes/No/N/A"-like sets. Fixing #3 removes the AI source; a **"merge duplicate response sets"** affordance in the Response-sets tab would clean up existing templates.

---

## Summary

| # | Severity | Finding | Fix size |
|---|---|---|---|
| 1 | High | Long title clipped in the header (single-line input) | Small |
| 2 | High | Long question prompt clipped — no multi-line | Small–Medium |
| 3 | High | AI generates duplicate response sets (triggers in the dedup key) | Medium (builder) |
| 4 | Medium | No "Project" response type; Site ignores terminology / kind | Medium |
| 5 | Low | Option labels / list prompts truncate | Small |
| 6 | Low | No way to merge existing duplicate response sets | Small–Medium |

**Recommended first pass:** #1 + #2 (the two "I can't read what I'm editing" bugs — small, high-relief) and #3 (the AI-duplicate flood — the highest-value backend fix). #4 (Project type) is the next most-requested. #5/#6 are polish.

_All four items in your message are reproduced and root-caused above (#1 title, #2 question, #3 AI duplicates, #4 project tagging), plus two related low-severity items I found while investigating._
