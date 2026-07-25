# UX audit — Heads Up

**Module:** Heads Up (broadcast a message to people/groups/sites + track view/acknowledge/sign). Router `packages/api/src/routers/headsUps.ts`.
**Investigated:** 2026-07-25 · full code map.
**Surfaces:** `app/[locale]/heads-up/{page,new,[headsUpId]}`, public `app/s/[token]/page.tsx`.

## Fixed (Workflow fan-out, 3 slices + adversarial verify)
- **List:** load-error branch (was a false-empty on fetch failure), app-locale dates, mobile card layout.
- **Compose:** an **empty-audience guard** — choosing groups/sites but selecting none no longer silently publishes to 0 recipients; the description box auto-grows (was `resize-none` on up to 5000 chars); dates/schedule times use the app locale + a consistent i18n time key; the Sites audience mode respects tenant **terminology**; the selected-doc chip no longer falls back to a raw ULID; pickers surface load errors.
- **Detail:** **archive confirms** (+ revoke-share-link confirms); every date on the Overview/Engagement/Comments tabs formats with the app locale; the 7-column recipients table gets a mobile card layout; the Engagement tab surfaces load errors instead of a false "no recipients".

## Deferred (flagged — feature-level / cross-cutting, not a UX-polish fix)
1. **[High — feature] No recipient-facing acknowledge / sign / view surface in the web app.** The router exposes `markViewed` / `markAcknowledged` / `sign` (`headsUps.ts:816,842,873`) but there are **zero UI call sites** — the list/detail pages are management-only and the compose "preview" Acknowledge/Sign button is inert (`new/page.tsx:842-854`). The core acknowledgement loop has no user path. Needs a product decision on where recipients see + acknowledge a heads-up (a dashboard/inbox widget, an email deep-link, or the public share route).
2. **[High — likely broken] The external "Share" link probably 404s.** The detail page builds `/s/${token}` (`[headsUpId]/page.tsx:156`), but the only `/s/[token]` route resolves **inspection** tokens via `validateShareToken` against `public_inspection_links` and `notFound()`s otherwise (`app/s/[token]/page.tsx:22-31`); heads-up tokens live separately on `headsUps.shareToken` (`headsUps.ts:599-613`). The public route needs to also resolve heads-up tokens (or a dedicated route). Cross-cutting (public route + token validation + router) — worth a dedicated fix + test.
3. **[Medium — feature] No individual-user targeting** — `recipientSpec.userIds` is hard-coded `[]` in compose (`new/page.tsx:301`) though the schema/router support it. Audience is limited to everyone/groups/sites.
4. **[Low] Non-optimistic reactions + comments** — emoji taps + comment posts lag a round-trip + refetch (`[headsUpId]/page.tsx:108-111,84-90`). Same class as the actions inline-edit lag; deferred.

_These four are genuine product/eng follow-ups (a recipient surface, a broken share route, individual targeting, optimistic UX) — out of scope for the UX-polish pass, which brought the management surfaces up to the app's error/mobile/i18n/confirmation bar._
