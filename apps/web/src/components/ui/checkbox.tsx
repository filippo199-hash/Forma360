'use client';

import { Check, Minus } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';

interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange'
> {
  checked?: boolean;
  'data-state'?: 'indeterminate' | undefined;
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  (
    {
      className,
      checked = false,
      'data-state': dataState,
      onCheckedChange,
      disabled,
      'aria-label': ariaLabel,
      ...rest
    },
    ref,
  ) => {
    const isIndeterminate = dataState === 'indeterminate';

    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={isIndeterminate ? 'mixed' : checked}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => {
          if (!disabled) onCheckedChange?.(!checked);
        }}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary ring-offset-background transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked || isIndeterminate ? 'bg-primary text-primary-foreground' : 'bg-background',
          className,
        )}
        {...(rest as Record<string, unknown>)}
      >
        {isIndeterminate ? (
          <Minus className="h-3 w-3" />
        ) : checked ? (
          <Check className="h-3 w-3" />
        ) : null}
      </button>
    );
  },
);
Checkbox.displayName = 'Checkbox';
