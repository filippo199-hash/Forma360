'use client';

import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Client-side mirror of the server's `ctx.permissions`. The Settings UI
 * uses it to grey out actions the user cannot invoke — the server is
 * still the source of truth; UI hiding is UX only (ground rule #6).
 */
const PermissionsContext = createContext<readonly string[]>([]);

export function PermissionsProvider({
  permissions,
  children,
}: {
  permissions: readonly string[];
  children: ReactNode;
}) {
  const value = useMemo(() => permissions, [permissions]);
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function useHasPermission(key: string): boolean {
  const perms = useContext(PermissionsContext);
  // Administrators (org.settings) implicitly hold every key — mirrors the
  // server so a pre-existing admin isn't locked out of newly-added modules.
  return perms.includes(key) || grantsAdminAccess(perms);
}
