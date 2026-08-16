/**
 * NR3-03 regression pin — a cancelled create dialog must not keep what
 * was typed. The shipped bug: form state lived in the always-mounted
 * register page and only create.onSuccess reset it, so Cancel/Escape →
 * reopen → retype produced "Test Roofing CoTest Roofing Co".
 *
 * Pins:
 *   1. Close via Cancel, then reopen → every input is empty.
 *   2. Close via Escape (Radix onOpenChange), then reopen → empty.
 *   3. A successful create also clears the form.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@forma360/i18n/messages/en';

const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));

vi.mock('../../lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({
      contractors: { list: { invalidate: () => Promise.resolve() } },
    }),
    contractors: {
      create: {
        useMutation: (opts: { onSuccess?: () => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            mutateMock(input);
            opts.onSuccess?.();
          },
        }),
      },
    },
  },
}));

import { CreateContractorDialog } from './create-contractor-dialog';

afterEach(() => {
  cleanup();
  mutateMock.mockClear();
});

const messages = {
  contractors: (en as Record<string, unknown>)['contractors'],
  common: (en as Record<string, unknown>)['common'],
};

function Harness({ initiallyOpen = true }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <NextIntlClientProvider locale="en" timeZone="Europe/London" messages={messages}>
      <button type="button" data-testid="reopen" onClick={() => setOpen(true)}>
        reopen
      </button>
      <CreateContractorDialog open={open} onOpenChange={setOpen} />
    </NextIntlClientProvider>
  );
}

function nameInput(): HTMLInputElement {
  return document.getElementById('c-name') as HTMLInputElement;
}

describe('CreateContractorDialog (NR3-03)', () => {
  it('clears every field when closed via Cancel and reopened', () => {
    render(<Harness />);
    fireEvent.change(nameInput(), { target: { value: 'Test Roofing Co' } });
    fireEvent.change(document.getElementById('c-cat') as HTMLInputElement, {
      target: { value: 'Roofing' },
    });
    fireEvent.change(document.getElementById('c-contact') as HTMLInputElement, {
      target: { value: 'Jo Smith' },
    });
    fireEvent.change(document.getElementById('c-email') as HTMLInputElement, {
      target: { value: 'jo@roofing.example' },
    });

    fireEvent.click(screen.getByRole('button', { name: en.common.cancel }));
    expect(nameInput()).toBeNull();

    fireEvent.click(screen.getByTestId('reopen'));
    expect(nameInput().value).toBe('');
    expect((document.getElementById('c-cat') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('c-contact') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('c-email') as HTMLInputElement).value).toBe('');
  });

  it('clears the form when dismissed via Escape (Radix onOpenChange)', () => {
    render(<Harness />);
    fireEvent.change(nameInput(), { target: { value: 'Test Roofing Co' } });

    fireEvent.keyDown(nameInput(), { key: 'Escape' });
    expect(nameInput()).toBeNull();

    fireEvent.click(screen.getByTestId('reopen'));
    expect(nameInput().value).toBe('');
  });

  it('clears the form after a successful create', () => {
    render(<Harness />);
    fireEvent.change(nameInput(), { target: { value: 'Test Roofing Co' } });
    fireEvent.click(screen.getByRole('button', { name: en.contractors.createButton }));
    expect(mutateMock).toHaveBeenCalledWith({
      name: 'Test Roofing Co',
      category: null,
      primaryContactName: null,
      primaryContactEmail: null,
    });
    // Dialog closed on success…
    expect(nameInput()).toBeNull();
    // …and reopening shows a blank form.
    fireEvent.click(screen.getByTestId('reopen'));
    expect(nameInput().value).toBe('');
  });
});
