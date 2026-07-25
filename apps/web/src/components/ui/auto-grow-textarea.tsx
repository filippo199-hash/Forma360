'use client';

import type { TextareaHTMLAttributes } from 'react';
import { forwardRef, useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * A `<textarea>` that grows with its content instead of scrolling a single
 * line. Used wherever a field must show the whole value (template titles,
 * question prompts) rather than clipping it. Height is recomputed on every
 * value change via layout effect, so it works with controlled values that
 * update from outside (e.g. reducer dispatch).
 */
export const AutoGrowTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, value, rows = 1, ...props }, forwardedRef) => {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  function setRefs(el: HTMLTextAreaElement | null) {
    innerRef.current = el;
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef !== null && forwardedRef !== undefined) forwardedRef.current = el;
  }

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={setRefs}
      rows={rows}
      value={value}
      className={cn('resize-none overflow-hidden', className)}
      {...props}
    />
  );
});
AutoGrowTextarea.displayName = 'AutoGrowTextarea';
