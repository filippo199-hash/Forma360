'use client';

/**
 * The rail's fold control, sitting at the left of the single top bar.
 * Desktop only — below `md` there is no rail to fold, the header's
 * hamburger opens the same items in a drawer instead.
 */

import { PanelLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNavCollapse } from '../../lib/nav-collapse-context';

export function NavCollapseToggle() {
  const t = useTranslations('nav');
  const { collapsed, toggle } = useNavCollapse();
  const label = collapsed ? t('expandMenu') : t('collapseMenu');

  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={!collapsed}
      aria-label={label}
      title={label}
      className="hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:inline-flex"
    >
      <PanelLeft className="h-[18px] w-[18px]" aria-hidden="true" />
    </button>
  );
}
