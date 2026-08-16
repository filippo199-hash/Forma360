'use client';

import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import type { ComponentPropsWithoutRef, HTMLAttributes } from 'react';
import { createContext, forwardRef, useContext, useEffect, useId, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * BUG-25: same description-registration scheme as ui/dialog.tsx — Sheet is
 * Radix Dialog under the hood, so a SheetContent without a SheetDescription
 * logs the same warning. The attribute is emitted only when a description
 * registers, keeping the wiring for sheets that do have one.
 */
interface DescriptionRegistry {
  id: string;
  register: (present: boolean) => void;
}
const DescriptionRegistryContext = createContext<DescriptionRegistry | null>(null);

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetPortal = SheetPrimitive.Portal;

export const SheetOverlay = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out',
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  'fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out overflow-auto',
  {
    variants: {
      side: {
        top: 'inset-x-0 top-0 border-b',
        bottom: 'inset-x-0 bottom-0 border-t',
        left: 'inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
        right: 'inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-md',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export interface SheetContentProps
  extends
    ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

export const SheetContent = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, ...props }, ref) => {
  const descriptionId = useId();
  const [hasDescription, setHasDescription] = useState(false);
  const registry = useMemo<DescriptionRegistry>(
    () => ({ id: descriptionId, register: setHasDescription }),
    [descriptionId],
  );
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={ref}
        aria-describedby={hasDescription ? descriptionId : undefined}
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        <DescriptionRegistryContext.Provider value={registry}>
          {children}
        </DescriptionRegistryContext.Provider>
        <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = SheetPrimitive.Content.displayName;

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col space-y-2 text-center sm:text-left', className)} {...props} />
  );
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
      {...props}
    />
  );
}

export const SheetTitle = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

export const SheetDescription = forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => {
  // See DescriptionRegistryContext above (BUG-25).
  const registry = useContext(DescriptionRegistryContext);
  useEffect(() => {
    registry?.register(true);
    return () => registry?.register(false);
  }, [registry]);
  return (
    <SheetPrimitive.Description
      ref={ref}
      {...(registry !== null ? { id: registry.id } : {})}
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
});
SheetDescription.displayName = SheetPrimitive.Description.displayName;
