import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * FreeHS e2e harness — a signed-in, seeded workspace per test.
 *
 * The try-it-now sandbox (ADR 0017) is the auth harness: one POST to
 * `/api/sandbox/create` provisions a seeded tenant, mints a real
 * better-auth session and sets the cookie on the browser context. No
 * email, no OTP, no bespoke seeding code — the same path a visitor
 * takes, which means every spec that uses this fixture also exercises
 * the acquisition funnel's server side.
 *
 * These specs only run against a FreeHS deployment: Forma360 does not
 * offer the sandbox, and `/api/sandbox/create` 404s there — see
 * `scenariosForBrand`. The fixture fails fast with a clear message when
 * pointed at the wrong brand.
 */

export interface SandboxChoice {
  scenarioId: 'riskAssessment' | 'inspection' | 'hazard' | 'permit' | 'incident' | 'rams';
  refinementId: string;
}

/**
 * The creation endpoint rate-limits 5/hour per client IP, keyed on
 * `x-real-ip` (the platform-set header; locally it is absent, so every
 * request would share one bucket and the suite would trip the limit on
 * its sixth provision). Locally WE are the client, so we hand each
 * provision a unique loopback-adjacent address. Against a real deployment
 * the platform overwrites the header and the limit applies as designed —
 * which is fine, because CI provisions fewer than five per runner-hour
 * only locally; the CI job boots its own instance where the header is
 * trusted.
 */
let provisionCounter = 0;
// One random octet per worker process: the counter alone repeats across
// suite runs within the same hour, and five repeats exhaust an IP's
// bucket. 10.x.y.z stays a syntactically ordinary private address.
const processOctet = Math.floor(Math.random() * 254) + 1;
export function uniqueClientIp(workerIndex: number): string {
  provisionCounter += 1;
  return `10.${(workerIndex % 100) + 100}.${processOctet}.${provisionCounter % 256}`;
}

export interface ProvisionedSandbox {
  /** Locale-relative landing route returned by the endpoint, e.g. `/permits`. */
  landingPath: string;
  /** Absolute in-app path with the `en` locale prefix, ready for page.goto(). */
  landingUrl: string;
}

/**
 * Provision a sandbox workspace onto the given browser context. The
 * session cookie from the response lands in the context's cookie jar via
 * `context.request`, so any page opened afterwards is signed in.
 */
export async function provisionSandbox(
  context: BrowserContext,
  choice: SandboxChoice,
  workerIndex: number,
): Promise<ProvisionedSandbox> {
  const response = await context.request.post('/api/sandbox/create', {
    data: choice,
    headers: { 'x-real-ip': uniqueClientIp(workerIndex) },
  });

  if (response.status() === 404) {
    throw new Error(
      'POST /api/sandbox/create returned 404 — the target deployment is not the FreeHS brand ' +
        '(the sandbox hangs off brand.offersSandbox). These specs require BRAND=freehs.',
    );
  }
  expect(
    response.ok(),
    `sandbox create failed: ${response.status()} ${await response.text().catch(() => '')}`,
  ).toBeTruthy();

  const body = (await response.json()) as { landingPath: string };
  expect(typeof body.landingPath).toBe('string');
  return { landingPath: body.landingPath, landingUrl: `/en${body.landingPath}` };
}

/**
 * Whether the target deployment offers the sandbox (⇔ it is the FreeHS
 * brand). Probed once per worker with a deliberately invalid body: the
 * brand check answers 404 before the body is parsed, so FreeHS answers
 * 400 and Forma360 answers 404. Lets the same e2e directory run under
 * both brands in CI — FreeHS journeys skip cleanly on the Forma360 leg.
 */
let brandProbe: Promise<boolean> | null = null;
function isFreehsTarget(context: BrowserContext, workerIndex: number): Promise<boolean> {
  brandProbe ??= context.request
    .post('/api/sandbox/create', {
      data: {},
      headers: { 'x-real-ip': uniqueClientIp(workerIndex) },
    })
    .then((res) => res.status() !== 404);
  return brandProbe;
}

/** Call once at the top of a FreeHS-only spec file, inside no describe. */
export function freehsOnly(): void {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(
      !(await isFreehsTarget(context, testInfo.workerIndex)),
      'FreeHS-only journey — the target brand does not offer the sandbox',
    );
  });
}

interface SandboxFixtures {
  /** Provision a seeded workspace and navigate the page to its landing route. */
  sandbox: (choice: SandboxChoice) => Promise<ProvisionedSandbox>;
}

export const test = base.extend<SandboxFixtures>({
  sandbox: async ({ context, page }, use, testInfo) => {
    await use(async (choice: SandboxChoice) => {
      const provisioned = await provisionSandbox(context, choice, testInfo.workerIndex);
      await page.goto(provisioned.landingUrl);
      return provisioned;
    });
  },
});

export { expect };

/**
 * Open `path` in a brand-new, cookie-less context — the anonymous
 * visitor. The caller must close the returned context.
 */
export async function openAnonymously(
  currentContext: BrowserContext,
  path: string,
): Promise<{ page: Page; context: BrowserContext }> {
  const browser = currentContext.browser();
  if (browser === null) throw new Error('context has no browser');
  // Same resolution as playwright.config.ts — the config's baseURL is not
  // readable off a live context, so the two lines share the env fallback.
  const context = await browser.newContext({
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
  });
  const page = await context.newPage();
  await page.goto(path);
  return { page, context };
}
