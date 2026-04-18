import { describe, expect, it } from 'vitest';
import {
  isPermissionKey,
  PERMISSION_KEYS,
  PERMISSION_MODULES,
  permissionsByModule,
  type PermissionKey,
} from './catalogue';

describe('PERMISSION_KEYS', () => {
  it('covers every Phase 0–10 module mentioned in the build plan', () => {
    // Sanity: exactly the module set we care about. If a module is
    // renamed, this test fails loudly and we update it deliberately.
    expect(new Set(PERMISSION_MODULES)).toEqual(
      new Set([
        'users',
        'groups',
        'sites',
        'permissions',
        'templates',
        'inspections',
        'issues',
        'actions',
        'headsUp',
        'assets',
        'documents',
        'analytics',
        'compliance',
        'training',
        'integrations',
        'billing',
        'org',
      ]),
    );
  });

  it('has at least 60 keys (Phase 1 prompt mandates ~80; floor check)', () => {
    expect(PERMISSION_KEYS.length).toBeGreaterThanOrEqual(60);
  });

  it('has no duplicate keys', () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
  });

  it('uses module.action(.subaction?) format for every key', () => {
    // Two or three dot-separated segments; first is the module, rest are
    // action / sub-action (lowerCamelCase alphanumerics allowed).
    for (const key of PERMISSION_KEYS) {
      expect(key, `key "${key}" must match module.action(.subaction?)`).toMatch(
        /^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*(\.[a-z][a-zA-Z]*)?$/,
      );
    }
  });

  it('every key starts with a recognised module prefix', () => {
    const modules = new Set<string>(PERMISSION_MODULES);
    for (const key of PERMISSION_KEYS) {
      const module = key.split('.')[0] ?? '';
      expect(modules.has(module), `unknown module for "${key}"`).toBe(true);
    }
  });

  it('exposes at least one .view and one .manage per module where both make sense', () => {
    // `org` uses `org.settings` and `org.audit.view` instead of .view/.manage.
    // `integrations` and `billing` are manage-only (no read-only surface).
    const skipView = new Set<string>(['org', 'integrations', 'billing']);
    const skipManage = new Set<string>(['org']);
    for (const mod of PERMISSION_MODULES) {
      const hasView = skipView.has(mod) || PERMISSION_KEYS.some((k) => k === `${mod}.view`);
      const hasManage = skipManage.has(mod) || PERMISSION_KEYS.some((k) => k === `${mod}.manage`);
      expect(hasView, `${mod}.view missing`).toBe(true);
      expect(hasManage, `${mod}.manage missing`).toBe(true);
    }
  });

  it('includes the administrator-identifying key org.settings', () => {
    // Per Phase 1 prompt S-E02: "admin" = holds org.settings.
    expect(PERMISSION_KEYS).toContain('org.settings' satisfies PermissionKey);
  });
});

describe('permissionsByModule', () => {
  it('groups every key by its module prefix', () => {
    const grouped = permissionsByModule();
    const flat = Object.values(grouped).flat();
    expect(new Set(flat)).toEqual(new Set(PERMISSION_KEYS));
  });

  it('keys inside a module group all share that module', () => {
    const grouped = permissionsByModule();
    for (const [mod, keys] of Object.entries(grouped)) {
      for (const k of keys) {
        expect(k.startsWith(`${mod}.`)).toBe(true);
      }
    }
  });
});

describe('isPermissionKey', () => {
  it('accepts every catalogued key', () => {
    for (const key of PERMISSION_KEYS) {
      expect(isPermissionKey(key)).toBe(true);
    }
  });

  it('rejects strings that look like keys but are not catalogued', () => {
    expect(isPermissionKey('templates.haxx')).toBe(false);
    expect(isPermissionKey('ghost.view')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isPermissionKey(null)).toBe(false);
    expect(isPermissionKey(undefined)).toBe(false);
    expect(isPermissionKey(42)).toBe(false);
    expect(isPermissionKey({})).toBe(false);
  });
});
