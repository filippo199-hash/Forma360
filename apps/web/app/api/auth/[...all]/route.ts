/**
 * better-auth HTTP entrypoint. Catches every route under /api/auth/* and
 * dispatches to the auth handler exposed by the server instance.
 *
 * The handler is wrapped to normalise the forwarded-IP headers first, because
 * better-auth's rate limiting is keyed on the client IP and its own reader
 * cannot be told which end of the chain to trust.
 */
import { resolveClientIp } from '@forma360/shared/client-ip';
import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '../../../../src/server/auth';

const handlers = toNextJsHandler(auth);

/**
 * RL-K01, for better-auth's limiter.
 *
 * `getIp` in better-auth does `value.split(',')[0].trim()` on whichever
 * header it is configured to read — always the LEFTMOST hop, which on a
 * proxied request is whatever the caller sent. Configuring
 * `advanced.ipAddress.ipAddressHeaders` only changes which header it reads,
 * not which end of the list it takes, so no amount of configuration fixes
 * this on its own. Naming a single-valued header instead (`x-real-ip`) is not
 * safe either: if the platform does not set it, `getIp` returns null and
 * better-auth *skips* rate limiting altogether — strictly worse than a
 * spoofable key.
 *
 * So the fix is here, upstream of better-auth: collapse both forwarded
 * headers to the one hop our own edge wrote (`resolveClientIp` takes the
 * rightmost). After this, `split(',')[0]` is the correct value and the two
 * limits configured in `packages/auth/src/server.ts` — 5 OTP sends per 300s
 * and the global 30 per 60s — actually bind. Before it, rotating one header
 * per request gave an attacker a fresh bucket every time, which made OTP
 * mail-bombing and brute-forcing a six-digit code unthrottled.
 */
function withTrustedClientIp(request: Request): Request {
  const ip = resolveClientIp(request.headers);
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-for', ip);
  headers.set('x-real-ip', ip);
  return new Request(request, { headers });
}

export function GET(request: Request): Promise<Response> {
  return handlers.GET(withTrustedClientIp(request));
}

export function POST(request: Request): Promise<Response> {
  return handlers.POST(withTrustedClientIp(request));
}
