'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export type SectionTab = 'inspections' | 'templates' | 'approvals' | 'schedules';

const TAB_PATHS: Record<SectionTab, string> = {
  inspections: '/inspections',
  templates: '/templates',
  approvals: '/approvals',
  schedules: '/schedules',
};

export function SectionTabBar({ activeTab, locale }: { activeTab: SectionTab; locale: string }) {
  const tNav = useTranslations('nav');
  const tabs: SectionTab[] = ['inspections', 'templates', 'approvals', 'schedules'];

  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b">
      {tabs.map((tab) => (
        <Link
          key={tab}
          href={`/${locale}${TAB_PATHS[tab]}`}
          aria-current={activeTab === tab ? 'page' : undefined}
          className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            activeTab === tab
              ? 'border-foreground font-semibold text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {tNav(tab)}
        </Link>
      ))}
    </div>
  );
}
