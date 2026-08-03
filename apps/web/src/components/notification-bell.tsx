'use client';

/**
 * Header notification bell (platform HSE review PF-23).
 *
 * Polls the unread count every 60 s; the popover pages the latest rows.
 * Clicking a row marks it read and follows its in-app link. The rows are
 * written by the same code paths that send the emails, so the bell and
 * the inbox never disagree.
 */
import { Bell, CheckCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '../lib/trpc/client';
import { cn } from '../lib/cn';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Skeleton } from './ui/skeleton';

function relativeTime(date: Date, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return rtf.format(-seconds, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.floor(hours / 24), 'day');
}

export function NotificationBell() {
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  const unread = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const list = trpc.notifications.list.useQuery({ limit: 20 }, { enabled: open });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate();
      void utils.notifications.list.invalidate();
    },
  });
  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: () => {
      void utils.notifications.unreadCount.invalidate();
      void utils.notifications.list.invalidate();
    },
  });

  const count = unread.data?.count ?? 0;

  function openItem(item: { id: string; href: string | null; readAt: Date | null }) {
    if (item.readAt === null) markRead.mutate({ id: item.id });
    if (item.href !== null) {
      setOpen(false);
      router.push(`/${locale}${item.href}`);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('bellLabel', { count })}
          className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Bell className="h-4.5 w-4.5 h-[18px] w-[18px]" aria-hidden="true" />
          {count > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">{t('title')}</p>
          {count > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-xs"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t('markAllRead')}
            </Button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {list.isLoading ? (
            <div className="space-y-2 p-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (list.data?.rows.length ?? 0) === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <ul>
              {(list.data?.rows ?? []).map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openItem(n)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 border-b px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/50',
                      n.readAt === null ? 'bg-primary/5' : undefined,
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {n.readAt === null ? (
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                      ) : null}
                      <span className="truncate text-sm font-medium">{n.title}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{t(`kinds.${n.kind}` as never)}</span>
                      {n.body.length > 0 ? <span className="truncate">· {n.body}</span> : null}
                      <span className="ml-auto shrink-0">
                        {relativeTime(new Date(n.createdAt), locale)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
