/**
 * BUG-11 regression pin — the toast stack must not cover the header.
 *
 * Round 2's fix moved toasts top-right (off the Save buttons) but left
 * sonner's default ~32px top offset, which parked the stack exactly over
 * the sticky header's search bar and notification bell. The wrapper now
 * starts the stack below the 56px header; this test pins the position
 * and the offset so neither regresses silently.
 */
import { cleanup, render } from '@testing-library/react';
import { toast } from 'sonner';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Toaster } from './sonner';

afterEach(cleanup);

describe('Toaster (BUG-11)', () => {
  it('renders top-right with a top offset clearing the 56px sticky header', async () => {
    render(<Toaster />);
    await act(async () => {
      toast('saved');
      // Sonner mounts the list lazily on the first toast.
      await new Promise((r) => setTimeout(r, 50));
    });

    const list = document.querySelector('[data-sonner-toaster]');
    expect(list).not.toBeNull();
    expect(list?.getAttribute('data-y-position')).toBe('top');
    expect(list?.getAttribute('data-x-position')).toBe('right');
    const style = (list as HTMLElement).style;
    expect(style.getPropertyValue('--offset-top')).toBe('64px');
  });
});
