/**
 * Resolve the caller's IP from proxy headers — RL-K01.
 *
 * `x-forwarded-for` is an APPEND-ONLY audit trail, and reading it from the
 * wrong end inverts its trust model. The header arrives as
 *
 *     <what the client claimed>, <what proxy 1 saw>, <what proxy 2 saw>
 *
 * Each proxy appends the address it received the connection FROM. So the
 * rightmost entry was written by our own edge and describes the hop that
 * actually reached it; every entry to its left was supplied by something
 * further out, and the leftmost is whatever the original caller typed into
 * the header. Nothing vouches for it.
 *
 * The context read `split(',')[0]` — the leftmost. Five rate limits were
 * keyed on that value, which means the caller chose their own key: rotate
 * the forged hop per request and every window is a fresh one. A limit
 * whose key the attacker picks is decorative. The keys were `auth:lookup`
 * (a cross-tenant account-existence oracle), `auth:signup` (anonymous
 * tenant creation), `sandbox:claim`, `sandbox:create` (anonymous seeded-
 * tenant provisioning) and `issue:qr:ip` (anonymous observation write).
 *
 * Taking the rightmost entry is correct for exactly one trusted reverse
 * proxy in front of the app, which is the Railway topology (ADR 0001). If
 * a second trusted hop is ever added, this becomes "the Nth from the
 * right" and must be revisited — hence one helper with a test rather than
 * an expression inlined in the context factory.
 */

/** Returned when no proxy header is usable. Never an empty string. */
export const UNKNOWN_CLIENT_IP = 'unknown';

/** The subset of `Headers` this needs; keeps the helper trivially testable. */
export interface ClientIpHeaders {
  get(name: string): string | null;
}

export function resolveClientIp(headers: ClientIpHeaders): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    // Rightmost non-empty hop: the one our own edge wrote.
    const hops = forwarded
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    const nearest = hops[hops.length - 1];
    if (nearest !== undefined) return nearest;
  }
  // `x-real-ip` is set by the proxy as a single value, so there is no end to
  // choose — but it is only trustworthy because the proxy overwrites it.
  // Used only when there is no forwarded-for to read.
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp !== undefined && realIp.length > 0) return realIp;
  return UNKNOWN_CLIENT_IP;
}
