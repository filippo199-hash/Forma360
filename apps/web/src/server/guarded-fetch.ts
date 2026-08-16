/**
 * The outbound fetch used for anything we retrieve from a customer-supplied
 * URL — the brand-palette harvest and the logo import.
 *
 * It exists once because the SSRF protection has to be identical on every
 * such path: resolve the hostname, refuse private addresses, then connect to
 * the address we validated rather than re-resolving (the DNS-rebinding
 * TOCTOU). A second copy of this is a second chance to get it wrong.
 */
import { lookup } from 'node:dns/promises';
import type { LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { isPrivateAddress, type FetchDeps, type ResolvedAddress } from './brand-palette';

/**
 * Connect to one of the already-validated addresses, preserving the hostname
 * for TLS SNI and certificate validation. Each address is re-checked here as
 * defence in depth — a validated set that somehow contains a private address
 * fails closed.
 *
 * Every address is tried, IPv4 first. A dual-stack host publishes both A and
 * AAAA and `lookup(..., verbatim)` keeps the resolver's order, which
 * routinely puts IPv6 first; a container without IPv6 egress then failed the
 * whole request on the first address and reported only `fetch failed`.
 * Multi-homed hosts exist so clients can fail over.
 */
export async function pinnedFetch(
  url: string,
  init: RequestInit,
  pin: readonly ResolvedAddress[],
): Promise<Response> {
  const safe = pin.filter((a) => !isPrivateAddress(a.address));
  if (safe.length === 0) {
    throw new Error('no public address to connect to');
  }

  const ordered = [...safe].sort((a, b) => a.family - b.family);
  const failures: string[] = [];

  for (const addr of ordered) {
    const dispatcher = new Agent({
      // Node's `LookupFunction` type describes only the `all: false`
      // overload; the runtime contract includes the array form, which is
      // the one Happy Eyeballs actually uses. `pinnedLookup` implements
      // both — see its test.
      connect: { lookup: pinnedLookup(addr) as unknown as LookupFunction },
    });
    try {
      /*
       * undici's OWN `fetch`, not the global one.
       *
       * Node bundles its own copy of undici behind `globalThis.fetch`, and
       * the two disagree about the dispatcher handler interface: handing a
       * userland `Agent` to the global fetch throws
       * `UND_ERR_INVALID_ARG: invalid onRequestStart method` before a packet
       * is sent. That is what every "Derive palette from website" hit, and
       * because the failure surfaced as `TypeError: fetch failed` it read as
       * an unreachable site. Verified against a real TLS server: global
       * fetch + this Agent fails 100% of the time; undici's fetch with the
       * same Agent returns 200.
       *
       * The cast is the boundary between undici's Response and the DOM one
       * the callers are typed against; the members we use (headers, status,
       * text, arrayBuffer, body) are identical.
       */
      const res = (await undiciFetch(url, {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher,
      })) as unknown as Response;
      // `close()` is graceful: undici waits for the in-flight request,
      // including the body the caller has yet to read.
      void dispatcher.close();
      return res;
    } catch (err) {
      void dispatcher.close();
      failures.push(`${addr.address} ${causeOf(err)}`);
    }
  }
  throw new Error(failures.join('; '));
}

/**
 * A `net.connect` lookup that always answers with one pinned address.
 *
 * It MUST honour `options.all`. Node's Happy-Eyeballs path
 * (`autoSelectFamily`, on by default since Node 20) calls the lookup with
 * `{ all: true }` and expects an ARRAY of `{ address, family }`; the
 * single-address form is only valid when `all` is false. Answering with the
 * string form regardless made every connect throw `UND_ERR_INVALID_ARG`,
 * which is why "Derive palette from website" had never once worked in
 * production — no site was ever unreachable, we simply never dialled one.
 * undici's own internal lookup branches on exactly this (see
 * `undici/lib/core/connect.js`).
 */
export function pinnedLookup(addr: ResolvedAddress) {
  return (
    _hostname: string,
    options: { all?: boolean } | undefined,
    cb: (
      err: Error | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ): void => {
    if (options?.all === true) {
      cb(null, [{ address: addr.address, family: addr.family }]);
      return;
    }
    cb(null, addr.address, addr.family);
  };
}

function causeOf(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code ?? cause.message;
  }
  return err.message;
}

/** Deps for the guarded fetch helpers in `brand-palette.ts`. */
export const fetchDeps: FetchDeps = {
  fetch: pinnedFetch,
  lookup: (hostname) => lookup(hostname, { all: true, verbatim: true }),
};
