/**
 * better-auth React client factory.
 *
 * Returns a client configured with the `twoFactor` plugin so callers can
 * invoke `authClient.twoFactor.*` without extra wiring.
 *
 * Consumers (apps/web in PR 9) call `createAuthClient({ baseURL })` once in
 * a browser module and export the resulting object for use in React components.
 */
import { twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient as createBetterAuthClient } from 'better-auth/react';

export interface AuthClientOptions {
  /**
   * Absolute URL of the better-auth server.
   * Defaults to same-origin when omitted.
   */
  baseURL?: string;
}

export function createAuthClient(options: AuthClientOptions = {}) {
  return createBetterAuthClient({
    ...(options.baseURL !== undefined ? { baseURL: options.baseURL } : {}),
    plugins: [twoFactorClient()],
  });
}

export type AuthClient = ReturnType<typeof createAuthClient>;
