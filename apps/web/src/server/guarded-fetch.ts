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
import { Agent } from 'undici';
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
      connect: {
        lookup: (
          _hostname: string,
          _options: unknown,
          cb: (err: Error | null, address: string, family: number) => void,
        ) => cb(null, addr.address, addr.family),
      },
    });
    try {
      // `dispatcher` is an undici-specific RequestInit extension.
      const res = await fetch(url, { ...init, dispatcher } as RequestInit & { dispatcher: Agent });
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
