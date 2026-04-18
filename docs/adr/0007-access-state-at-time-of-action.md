# ADR 0007 — Access state is captured at the time an action starts

**Status:** Accepted
**Date:** 2026-04-18

## Context

Phase 1 introduces rule-based membership for groups and sites plus the
advanced access rule primitive that gates templates / inspections / issues /
actions / training in Phase 2+.

Rule-based membership evaluates against live user custom-field values. When
a user's field changes (promotion, shift re-assignment, department move),
the reconcile job re-materialises `group_members` and `site_members` to
match — which in turn changes what features, templates, and schedules the
user sees.

That's fine for *future* work. It is not fine for *in-flight* work. The
Phase 1 prompt flags edge case **G-E08** explicitly:

> "A rule-based group membership changes a user's group, which changes
> their template access, which affects an in-progress inspection.
> In-progress inspections are not affected by access changes. The
> inspection continues with the access state at the time it was started.
> Future inspections respect the new access state."

Phase 1 does not yet ship Templates, Inspections, or any module that has
an "in-progress" state. But we need to lock the rule in now, because
every Phase 2+ module that supports long-running work will have to
implement it the same way — and retrofitting a different model across
seven modules later would be an enormous task.

## Decision

**When a user starts an action with long-running state (conducting an
inspection, responding to a Heads Up, completing a training course,
collecting evidence for a compliance rule), the module snapshots the
relevant access state onto the row at the moment the action starts. The
snapshot is not re-evaluated as the user's group/site/permission-set
memberships change over the lifetime of that action.**

Concretely, every module that introduces a long-running action is
expected to:

1. Identify the *access-determining fields* on its primary record. These
   are the fields whose values would change whether the user can
   continue, sign, or complete the action.
2. Add those fields to the row at creation time. For example:
   - `inspections.accessAtStart.templateId` — the template version
     snapshot (already ADR 0005-style versioned).
   - `inspections.accessAtStart.groupIds`, `siteIds` — the user's
     memberships at the moment they clicked *Start*.
   - `inspections.accessAtStart.permissionSetId` — the set the user
     held at start.
3. Every server-side check during the action's lifetime reads from the
   snapshot, never from the live membership/permission state.
4. The action's completion / signature / final state is derived from the
   snapshot. Once the action terminates, future actions by the same user
   resolve against the live state again.

## Scope — what is NOT snapshotted

- **Per-user permission changes that revoke access to a module entirely.**
  If an admin removes `inspections.conduct` from a user's set while they
  are conducting an inspection, the inspection can still be completed —
  the ongoing action was started with the correct permission. But the
  user cannot *start a new* inspection. This is the point of the ADR.
- **Access rules invalidated by a group / site archive (G-E06).** If the
  rule a user came in through is invalidated, their running inspection
  still completes; only new starts are blocked.
- **Self-deactivation.** A deactivated user cannot authenticate, so the
  question is moot — their in-progress work is preserved as data but
  they cannot return to it until reactivated.

## Rationale

1. **Compliance integrity.** An audited inspection is a signed
   statement of what was true at the time the inspector signed. If the
   inspector's access evaporates mid-form, the audit trail has to
   reflect their state at start, not their state at submission.
2. **Offline continuity (Phase 6).** Field workers conducting offline
   inspections would otherwise need a delta-sync for access changes —
   effectively impossible without ambient connectivity. A start-time
   snapshot makes the offline story trivial.
3. **Sane UX.** A user who has been filling in a 40-question inspection
   for 10 minutes should not suddenly hit "access denied" because a
   rule fired in the background. The UI will never have to explain that.
4. **Deterministic replay.** Historical analytics and audit replays
   must produce stable answers; a rule re-evaluated months later
   against a different membership graph would not.

## Consequences

- Every Phase 2+ module that supports an in-progress state adds a
  snapshot column. Module prompts include this in the schema section.
- The snapshot lives on the primary row (not a separate table). It is
  small (IDs only, no denormalised copies of permissions) and is read
  every time the action is loaded, so keeping it inline saves a join.
- Compliance evidence collection (Phase 8) reads the snapshot for
  historical rules and the live state for "due soon / in progress"
  rules. The compliance engine's ADR will spell that out when it lands.
- The rule evaluator in `@forma360/permissions/rules` stays pure — it
  takes a `UserFieldSnapshot` as input. Whether the snapshot is "live"
  or "captured at action start" is the module's choice, not the
  evaluator's.
- The reconcile jobs in `@forma360/jobs` continue to update
  `group_members` / `site_members` live. They do NOT look at
  in-progress actions; the in-progress rows hold their own snapshots.

## Non-options that were rejected

- **Re-evaluate on every read.** Runs fine at 10 users, falls apart at
  10k. And it breaks the compliance audit integrity argument above.
- **Freeze every action's membership in a separate `access_snapshots`
  table.** Extra join on every read of every in-progress row for no
  upside.
- **Versioned access rules with effective-date windows.** Dramatically
  more complex and has no product benefit the snapshot approach doesn't
  already give us.
