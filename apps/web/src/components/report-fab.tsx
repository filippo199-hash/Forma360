'use client';

/**
 * Mobile-only floating report action (UI review item 6). On a phone the
 * bottom-right corner is the thumb's home, and in field apps that corner
 * conventionally means CREATE — yet it was held by the chat bubble while
 * "Report" sat in the header, the least reachable place one-handed. The
 * bubble no longer renders on phones at all (the AI Agent lives in the
 * bottom tab bar instead); the frontline registers (observations,
 * incidents) render this in the freed corner.
 *
 * Desktop never shows it — the header button remains the primary action
 * there. Sits at `bottom-20` to clear the fixed mobile tab bar.
 */
import { Plus } from 'lucide-react';
import Link from 'next/link';

export function ReportFab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="fixed bottom-20 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 md:hidden"
    >
      <Plus className="h-6 w-6" aria-hidden="true" />
    </Link>
  );
}
