import { useTranslations } from 'next-intl';

export function SiteFooter() {
  const t = useTranslations('common');
  const year = new Date().getFullYear();
  return (
    <footer className="border-t text-xs text-muted-foreground">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <span>© {year} Forma360</span>
        <span className="text-muted-foreground/60">{t('footer.tagline')}</span>
      </div>
    </footer>
  );
}
