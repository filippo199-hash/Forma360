/**
 * BUG-25 regression pin — dialog/sheet description wiring.
 *
 * Radix warns ("Missing `Description` or `aria-describedby={undefined}`")
 * for content without a description. The naive central opt-out —
 * hardcoding aria-describedby={undefined} — silences the warning but ALSO
 * severs the linkage for dialogs that DO render a DialogDescription
 * (appConfirm's question, for one). Pins:
 *   1. Content without a description renders no aria-describedby and
 *      triggers no Radix description warning.
 *   2. Content WITH a description keeps aria-describedby pointing at the
 *      rendered description element.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';

afterEach(cleanup);

describe('DialogContent description wiring (BUG-25)', () => {
  it('renders no aria-describedby and no Radix warning without a description', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Plain form</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const content = screen.getByRole('dialog');
    expect(content.getAttribute('aria-describedby')).toBeNull();
    expect(warn.mock.calls.some((args) => String(args[0]).includes('Missing `Description`'))).toBe(
      false,
    );
    warn.mockRestore();
  });

  it('keeps aria-describedby pointing at a rendered DialogDescription', async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Are you sure?</DialogTitle>
          <DialogDescription>This deletes the record.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const content = screen.getByRole('dialog');
    const description = screen.getByText('This deletes the record.');
    await waitFor(() => {
      expect(content.getAttribute('aria-describedby')).toBe(description.id);
    });
    expect(description.id.length).toBeGreaterThan(0);
  });
});

describe('SheetContent description wiring (BUG-25)', () => {
  it('renders no aria-describedby and no Radix warning without a description', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Detail panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const content = screen.getByRole('dialog');
    expect(content.getAttribute('aria-describedby')).toBeNull();
    expect(warn.mock.calls.some((args) => String(args[0]).includes('Missing `Description`'))).toBe(
      false,
    );
    warn.mockRestore();
  });

  it('keeps aria-describedby pointing at a rendered SheetDescription', async () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Detail panel</SheetTitle>
          <SheetDescription>Everything about this record.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const content = screen.getByRole('dialog');
    const description = screen.getByText('Everything about this record.');
    await waitFor(() => {
      expect(content.getAttribute('aria-describedby')).toBe(description.id);
    });
  });
});
