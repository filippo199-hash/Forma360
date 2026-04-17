import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { LocalePicker } from './locale-picker';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  const t = useTranslations('common');

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Forma360
        </Link>
        <nav aria-label={t('navigation.primary')} className="flex items-center gap-1">
          <LocalePicker />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
