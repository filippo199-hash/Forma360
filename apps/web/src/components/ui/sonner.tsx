'use client';

import { useTheme } from 'next-themes';
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

/**
 * Thin wrapper around the sonner Toaster that picks up the current theme
 * from next-themes. Mounted once in the locale layout.
 *
 * BUG-11: toasts used to appear bottom-right — directly over the Save button
 * in the fire-door inspection sheet and every other dialog whose primary
 * action sits in that corner — and the defaults were left implicit, so a
 * burst of saves piled up and covered the control the user was trying to
 * press. Moved to top-right (away from primary actions), given an explicit
 * dismissal time, capped so a burst cannot become a wall, and given a close
 * button so anyone can clear one immediately.
 */
export function Toaster({ ...props }: ToasterProps) {
  const { theme } = useTheme();
  const resolved: 'light' | 'dark' | 'system' =
    theme === 'light' || theme === 'dark' ? theme : 'system';
  return (
    <SonnerToaster
      theme={resolved}
      position="top-right"
      duration={4000}
      visibleToasts={3}
      closeButton
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}
