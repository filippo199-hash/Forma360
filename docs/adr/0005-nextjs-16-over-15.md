# ADR 0005 — Next.js 16 over Next.js 15

**Status:** Accepted
**Date:** 2026-04-17

## Context

The original `FORMA360_BUILD_PLAN.md` (written before current versions were verified) locked the web framework at Next.js 15. Phase 0 scaffolding is the last moment we can change the Next.js major without refactoring work already shipped.

## Decision

Use **Next.js 16** for `apps/web`.

## Rationale

Next.js 16 went stable Oct 2025 and is the default for new projects. Next.js 15 LTS runs until Oct 2026, so Next 16 gives us the longer runway before another major migration is forced on us.

## Consequences

- `apps/web` pins Next.js 16.x.
- `next-intl`, `@sentry/nextjs`, and any other Next-adjacent packages must be installed at versions compatible with Next 16.
- The build plan's stack table has been updated to match.
- If a required peer (e.g. `next-intl`) lacks a Next 16-compatible release at install time, we stop and reassess rather than downgrade silently.
