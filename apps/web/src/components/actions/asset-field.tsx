'use client';

/**
 * AssetField — view + edit the assets an action is attached to.
 *
 * Read-only viewers see the linked assets as links (or "No asset").
 * Managers get removable chips plus a searchable, hierarchical picker, so
 * any action — including older ones that were never linked — can have its
 * asset attachment changed. Every change calls `onChange` with the full next
 * id list (the `actions.update` mutation replaces `action_assets`).
 *
 * The picker used to be a native `<select>`: every asset in the tenant, flat,
 * in one scroll. See {@link AssetPicker} for why that had to go.
 */

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { AssetPicker } from '../selectors/asset-picker';

export function AssetField({
  linked,
  canEdit,
  locale,
  onChange,
}: {
  /** Currently-linked assets (id + display name), from `actions.get`. */
  linked: ReadonlyArray<{ id: string; name: string }>;
  canEdit: boolean;
  locale: string;
  onChange: (nextIds: string[]) => void;
}) {
  const tFields = useTranslations('actions.detail.fields');
  const selectedIds = linked.map((a) => a.id);

  if (!canEdit) {
    if (linked.length === 0) {
      return <span className="text-muted-foreground">{tFields('noAsset')}</span>;
    }
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {linked.map((a) => (
          <Link
            key={a.id}
            href={`/${locale}/assets/${a.id}`}
            className="text-primary hover:underline"
          >
            {a.name}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {linked.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {linked.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-md border bg-muted px-2 py-0.5 text-xs"
            >
              <Link href={`/${locale}/assets/${a.id}`} className="hover:underline">
                {a.name}
              </Link>
              <button
                type="button"
                onClick={() => onChange(selectedIds.filter((id) => id !== a.id))}
                className="text-muted-foreground hover:text-foreground"
                aria-label={tFields('removeAsset')}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <AssetPicker
        selectedIds={selectedIds}
        onToggle={(assetId, selected) =>
          onChange(
            selected ? [...selectedIds, assetId] : selectedIds.filter((id) => id !== assetId),
          )
        }
        placeholder={linked.length === 0 ? tFields('noAsset') : tFields('addAsset')}
      />
    </div>
  );
}
