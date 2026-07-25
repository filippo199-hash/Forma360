'use client';

import { useTranslations } from 'next-intl';
import {
  permissionsByModule,
  PERMISSION_MODULES,
  type PermissionModule,
} from '@forma360/permissions/catalogue';
import { Checkbox } from '../ui/checkbox';

interface PermissionMatrixProps {
  /** The currently-granted permission keys. */
  draft: ReadonlySet<string>;
  /** Called with the full next set whenever a key or module toggles. */
  onChange: (next: Set<string>) => void;
  /** When true, every control is disabled (system sets are read-only). */
  readOnly?: boolean;
}

const BY_MODULE = permissionsByModule();

/**
 * The permission grid. One collapsible-free section per module: a header row
 * with a tri-state module checkbox that selects / clears every key in the
 * module, then one checkbox per key. Fully controlled — the parent owns the
 * draft `Set` and receives the next set through `onChange`.
 */
export function PermissionMatrix({ draft, onChange, readOnly = false }: PermissionMatrixProps) {
  const t = useTranslations('settings.permissions');

  function toggleKey(key: string) {
    if (readOnly) return;
    const next = new Set(draft);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  }

  function toggleModule(keys: readonly string[], allSelected: boolean) {
    if (readOnly) return;
    const next = new Set(draft);
    if (allSelected) {
      for (const k of keys) next.delete(k);
    } else {
      for (const k of keys) next.add(k);
    }
    onChange(next);
  }

  return (
    <div className="space-y-6">
      {PERMISSION_MODULES.map((mod: PermissionModule) => {
        const keys = BY_MODULE[mod];
        const selectedCount = keys.filter((k) => draft.has(k)).length;
        const allSelected = selectedCount === keys.length;
        const noneSelected = selectedCount === 0;

        return (
          <section key={mod} className="space-y-2">
            <div className="flex items-center gap-2 border-b pb-2">
              <Checkbox
                checked={allSelected}
                {...(!allSelected && !noneSelected
                  ? { 'data-state': 'indeterminate' as const }
                  : {})}
                onCheckedChange={() => toggleModule(keys, allSelected)}
                disabled={readOnly}
                aria-label={t('edit.selectAll')}
              />
              <span className="text-sm font-semibold">{t(`modules.${mod}`)}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {selectedCount}/{keys.length}
              </span>
            </div>
            <ul className="space-y-1.5 pl-6">
              {keys.map((key) => {
                const id = `perm-${key.replaceAll('.', '-')}`;
                return (
                  <li key={key} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={draft.has(key)}
                      onCheckedChange={() => toggleKey(key)}
                      disabled={readOnly}
                    />
                    <label
                      htmlFor={id}
                      className="cursor-pointer text-sm text-muted-foreground"
                    >
                      {t(`perms.${key.replaceAll('.', '_')}`)}
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
