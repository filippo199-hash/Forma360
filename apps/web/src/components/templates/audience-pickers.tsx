'use client';

import { useTranslations } from 'next-intl';
import { usePlaceTerms } from '../../lib/terminology';
import { SiteSelector } from '../selectors/site-selector';
import { GroupUserSelector } from '../selectors/group-user-selector';

/**
 * Audience pickers used across the app (template publish, schedules,
 * observation categories, heads-up, …). These keep their original
 * `{ selected, onChange }` signature but now delegate to the shared,
 * redesigned selectors:
 *   - sites  → hierarchical, searchable {@link SiteSelector}
 *   - groups → {@link GroupUserSelector} in "groups" mode
 *   - users  → {@link GroupUserSelector} in "users" mode
 */

interface AudiencePickerProps {
  selected: readonly string[];
  onChange: (next: string[]) => void;
}

export function GroupPicker({ selected, onChange }: AudiencePickerProps) {
  const t = useTranslations('templates.editor.publishTab');
  return (
    <GroupUserSelector
      mode="groups"
      value={selected}
      onChange={onChange}
      label={t('groupsLabel')}
      placeholder={t('addGroups')}
    />
  );
}

export function SitePicker({ selected, onChange }: AudiencePickerProps) {
  const { labelPlural, addPlaceholder } = usePlaceTerms();
  return (
    <SiteSelector
      value={selected}
      onChange={onChange}
      label={labelPlural}
      placeholder={addPlaceholder}
    />
  );
}

export function UserPicker({ selected, onChange }: AudiencePickerProps) {
  const t = useTranslations('templates.editor.publishTab');
  return (
    <GroupUserSelector
      mode="users"
      value={selected}
      onChange={onChange}
      label={t('usersLabel')}
      placeholder={t('addUsers')}
    />
  );
}
