# Security policy

## Reporting a vulnerability

Email **privacy@freehs.software** (FreeHS) or **privacy@forma360.io**
(Forma360) with:

- what you found and where (a URL, a file path, or a request is ideal),
- what an attacker could do with it,
- how to reproduce it.

> **Maintainer note:** those are the only contact addresses that exist today
> (`packages/shared/src/brand.ts` — there is no `security@` alias). A dedicated
> `security@` on both domains would be better; create it and update this file
> rather than publishing an address that bounces.

Please report privately first rather than opening a public issue, and give us a
chance to ship a fix before disclosing. We will acknowledge within 3 working
days and tell you what we intend to do.

You may test against your own workspace, including a `/try` sandbox. Please do
not test against another customer's tenant, run denial-of-service or load
tests, or use automated scanners against production.

## What we consider in scope

- Anything that crosses a tenant boundary — reading, writing, or inferring the
  existence of another tenant's data.
- Authentication or session handling: signing in as someone else, keeping
  access after being deactivated, or bypassing the email-OTP flow.
- Permission bypass: performing an action without the permission the server
  requires for it.
- Access-token handling on the public surfaces (`/s/<token>`,
  `/scan/<token>`, contractor upload links, kiosk links).
- Server-side request forgery, injection, or remote code execution.
- Exposure of secrets, or of personal data such as incident records marked
  confidential.

## Known accepted risks

Stated so a report of one is not a surprise on either side:

- **`script-src` includes `'unsafe-inline'`.** Next's App Router inlines its
  hydration bootstrap and there is no nonce plumbing, because middleware does
  not run on `/api`, `/render`, `/s` or `/scan` — a nonce would cover only part
  of the app. The policy still blocks script from any other origin. See the
  reasoning in `apps/web/next.config.ts`.
- **`img-src`/`media-src` allow `https:`.** Attachments are served as a
  redirect to a per-deployment R2 domain; naming it would couple the policy to
  an env var. Images and video cannot execute.
- **Tenant isolation is enforced in the application layer, not by Postgres
  row-level security.** Every user-data table carries `tenant_id` and every
  query scopes by it (ADR 0002), but there is no database-level backstop yet.
  A missed predicate would be a real finding — please report it.
- **Share tokens are stored unhashed.** They are 128–256 bits of CSPRNG output
  and revocable; hashing at rest is planned.
- **Dashboard delivery schedules may target external email addresses.** This is
  a deliberate product decision, capped per dashboard, and withheld from
  sandbox workspaces.

## Supported versions

Forma360 and FreeHS are continuously deployed. Only the currently deployed
revision is supported; there are no maintained release branches.
