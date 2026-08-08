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

/** Raw permission list — for components that gate MANY keys (the nav). */
export function usePermissionList(): readonly string[] {
  return useContext(PermissionsContext);
}

export function useHasPermission(key: string): boolean {
  const perms = useContext(PermissionsContext);
  // Administrators (org.settings) implicitly hold every key — mirrors the
  // server so a pre-existing admin isn't locked out of newly-added modules.
  return perms.includes(key) || grantsAdminAccess(perms);
}

/**
 * Client-side mirror of the tenant's plan entitlements (ADR 0018). Like
 * permissions, this is UX-only — every paid surface re-checks server-side
 * via `requireEntitlement`. No admin bypass: the PLAN lacks the feature,
 * not the person.
 */
const EntitlementsContext = createContext<readonly string[]>([]);

export function EntitlementsProvider({
  entitlements,
  children,
}: {
  entitlements: readonly string[];
  children: ReactNode;
}) {
  const value = useMemo(() => entitlements, [entitlements]);
  return <EntitlementsContext.Provider value={value}>{children}</EntitlementsContext.Provider>;
}

export function useEntitlementList(): readonly string[] {
  return useContext(EntitlementsContext);
}

export function useHasEntitlement(key: string): boolean {
  return useContext(EntitlementsContext).includes(key);
}
