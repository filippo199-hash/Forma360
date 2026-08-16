'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, HTMLAttributes } from 'react';
import { createContext, forwardRef, useContext, useEffect, useId, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

/**
 * BUG-25: Radix logs "Missing `Description` or `aria-describedby={undefined}`"
 * for every DialogContent without a DialogDescription — most of ours are
 * plain forms with no description copy worth inventing. The documented
 * opt-out is an explicit `aria-describedby={undefined}`, but hardcoding it
 * here would ALSO sever the description linkage for dialogs that DO render
 * a DialogDescription (Radix spreads caller props over its own default).
 * So DialogContent emits the attribute only once a DialogDescription
 * registers itself through this context — no warning without one, correct
 * wiring with one.
 */
interface DescriptionRegistry {
  id: string;
  register: (present: boolean) => void;
}
const DescriptionRegistryContext = createContext<DescriptionRegistry | null>(null);

export const DialogOverlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const DialogContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  const descriptionId = useId();
  const [hasDescription, setHasDescription] = useState(false);
  const registry = useMemo<DescriptionRegistry>(
    () => ({ id: descriptionId, register: setHasDescription }),
    [descriptionId],
  );
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        aria-describedby={hasDescription ? descriptionId : undefined}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 max-h-[90vh] overflow-auto sm:w-full',
          className,
        )}
        {...props}
      >
        <DescriptionRegistryContext.Provider value={registry}>
          {children}
        </DescriptionRegistryContext.Provider>
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => {
  // See DescriptionRegistryContext above (BUG-25).
  const registry = useContext(DescriptionRegistryContext);
  useEffect(() => {
    registry?.register(true);
    return () => registry?.register(false);
  }, [registry]);
  return (
    <DialogPrimitive.Description
      ref={ref}
      {...(registry !== null ? { id: registry.id } : {})}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
});
DialogDescription.displayName = DialogPrimitive.Description.displayName;
