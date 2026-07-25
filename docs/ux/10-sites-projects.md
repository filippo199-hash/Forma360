# UX audit — Sites & Projects

**Module:** Sites & Projects (one `sites` table, `kind` = site|project; hub, overview + cards/tabs, media, plans/pins, team & access, location, the tenant terminology setting). Router `sites.ts`.
**Investigated:** 2026-07-25 · full code map.
**Surfaces:** `app/[locale]/sites/{page,[siteId]}`, `src/components/sites/*`, `src/lib/terminology.ts`.

## Fixed (Workflow fan-out, 6 slices + adversarial verify)
- **Overview cards:** the 8 card queries now show an inline "couldn't load" on failure (were silent zero-states); the link picker no longer shows a raw ULID or a raw English enum status (localised); truncated titles get tooltips; the hardcoded "Something went wrong" is localised.
- **Hub:** load-error state (was a false "No sites yet"); **end≥start date validation** in the create dialog; card-name tooltips; an empty-state Create CTA.
- **Overview shell:** the timeline dates are locale-formatted (were raw `YYYY-MM-DD`).
- **Plans/pins:** **pin delete now confirms** (was one-click); manage-levels rename gives a success toast; reorder arrows disable while pending.
- **Media:** the 2000-char caption editor is now multi-line (was a single-line input); tile caption tooltips.
- **Header/edit:** a **parent field** was added to the edit dialog (wired to `sites.move`, excluding self+descendants) so a site/project can be **re-parented after creation** (previously impossible from the UI); end≥start validation on edit too.

**Good (left as-is):** terminology coverage is solid across the module (hub/overview/dialog/nav/breadcrumb all respect the tenant setting — no stray hardcoded "Sites"); the overview **page** already reads `error`→not-found; archive already shows a dependents preview with dissociate/delete; team-access saves optimistically; the location typeahead has full keyboard support.

## Deferred (flagged)
- Native `window.confirm` for media/plan deletes (works; a styled Dialog would be more consistent).
- Non-optimistic field edits (round-trip + invalidate) on header/location.
- Plans-tab titles are generic rather than terminology-aware (minor).
