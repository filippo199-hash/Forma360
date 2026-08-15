'use client';

/**
 * AssetField — view + edit the assets an action is attached to.
 *
 * Read-only viewers see the linked assets as links (or "No asset").
 * Managers get removable chips plus an "add" dropdown, so any action —
 * including older ones that were never linked — can have its asset
 * attachment changed. Every change calls `onChange` with the full next
 * id list (the `actions.update` mutation replaces `action_assets`).
 */

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { trpc } from '../../lib/trpc/client';

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

  // Only fetch the full asset list when the user can actually edit — a
  // read-only viewer already has the names it needs from `linked`.
  const { data: allAssets } = trpc.assets.list.useQuery({}, { enabled: canEdit });
  const available = (allAssets?.assets ?? []).filter((a) => !selectedIds.includes(a.id));

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
      <select
        value=""
        onChange={(e) => {
          if (e.target.value !== '') onChange([...selectedIds, e.target.value]);
        }}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
      >
        <option value="">{linked.length === 0 ? tFields('noAsset') : tFields('addAsset')}</option>
        {available.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
