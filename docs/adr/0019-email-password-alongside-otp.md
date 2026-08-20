# ADR 0019 — Email + password sign-in alongside OTP

**Status:** Accepted
**Date:** 2026-08-20
**Supersedes:** the "passwordless by design" stance embedded in the
Phase 0 auth setup (no prior ADR recorded it; `packages/auth/src/server.ts`
and the auth router carried it in comments)
**Related:** ADR 0004 (user-table tenant extension), ADR 0017 (sandbox
sessions)

## Context

Since Phase 0, the only way into the product was the email-OTP exchange:
prove control of the inbox at each session start, no credential rows
consulted. That was a deliberate simplification — nothing to breach,
nothing to reset — and the 90-day sliding session made it feel like
"stay signed in".

It failed an external constraint: Google's app review policies require
working reviewer credentials that do not depend on access to a private
inbox. An OTP-only product cannot hand Google a test login. Passwordless
also has an ongoing UX tax (every fresh device pays an inbox round-trip)
and an availability coupling (email delivery down = nobody signs in).

## Decision

Email + password becomes a **first-class sign-in method beside OTP —
not a replacement**. Every account keeps OTP forever; a password is
required at sign-up and invite acceptance, and existing accounts pick
one up quietly (Settings → Profile, or the forgot-password flow, whose
reset exchange creates the credential row when none exists).

The load-bearing choices:

1. **Sign-up stays ours.** better-auth's `/sign-up/email` remains
   disabled (`emailAndPassword.disableSignUp`): a tenant row must exist
   before a user row (ADR 0004), and only `signUpWithTenant` /
   `acceptInvite` know how to make one. They hash with
   `@forma360/auth/crypto` — better-auth's own scrypt — and insert the
   `credential` account row (`accountId = userId`,
   `providerId = 'credential'`) in the same transaction, so
   `/sign-in/email` verifies it natively. No schema change: the
   `account.password` column existed from Phase 0.
2. **Verification stays the OTP exchange.** `requireEmailVerification`
   refuses password sign-in until `emailVerified` — which only the OTP
   exchange flips. The sign-in UI answers that refusal by sending a
   code, so an interrupted sign-up self-heals. Invite acceptance is
   already inbox-proof (the token arrived by email), so it creates the
   user verified and signs in with the new password immediately.
3. **One policy module.** `@forma360/shared/password` owns min 12 /
   max 128 and the Zod schema; length is the only composition rule
   (NIST 800-63B posture). Every path that accepts a new password also
   runs the **fail-open** HIBP k-anonymity check in
   `@forma360/shared/password-breach` — the tRPC mutations via router
   deps, `/reset-password` + `/change-password` via a better-auth
   before-hook, the settings route directly. Fail-open is deliberate:
   an HIBP outage must never become a sign-up or reset outage.
   better-auth's own `haveIBeenPwned` plugin fails closed and cannot
   see the tRPC path, which is why it is not used.
4. **Nothing silent.** Every completed set / change / reset sends the
   `password-changed` template to the account inbox; reset revokes all
   sessions (`revokeSessionsOnPasswordReset`), change revokes all
   others. Reset tokens live 30 minutes — the number printed in every
   locale's email copy; change both together or neither.
5. **Generic failures.** `/sign-in/email` 401s identically for unknown
   email and wrong password; the reset request answers "if an account
   exists…" with better-auth's timing mitigation. Per-path rate limits
   ride the RL-K01 trusted-IP wrapper (sign-in 10/60 s, reset request
   5/300 s, reset + change 10/300 s) plus a per-user limit on the
   settings route.
6. **Deactivation posture unchanged.** A password sign-in will mint a
   session for a deactivated user exactly as OTP always has; the
   control is the live `isUserActive` check on every request (SEC-D01),
   not the sign-in gate.

## Consequences

- Google review gets durable credentials; users get an inbox-free
  sign-in; email-delivery incidents no longer lock everyone out.
- The credential rows are a new secret store: scrypt-hashed, never
  selected by application reads (`users.get` exposes only a
  `hasPassword` boolean).
- 2FA enrolment UI remains future work (M10); the `twoFactor` plugin
  stays server-side and the sign-in card treats `twoFactorRedirect` as
  an error until a UI exists.
- The sandbox is untouched: sandbox sessions are minted directly
  (ADR 0017), and a claimed sandbox account adds a password like any
  other OTP-era account.
