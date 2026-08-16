/**
 * NR3-02 regression pin — the person picker must never offer a stale row.
 *
 * The shipped trap: search is debounced 250ms then round-trips to the
 * server, but the option list kept rendering the PREVIOUS result page
 * while the user typed. Typing "Grace Adeyemi (NEBOSH…)" and clicking the
 * next form field landed the click on a stale "Tom Baird" row — silently
 * recording the wrong assessor on a legal FRA and consuming the click.
 *
 * Pins:
 *   1. Rows that do not match the LIVE typed text disappear immediately —
 *      before the debounce fires, before any refetch.
 *   2. The free-text row offers exactly what was typed (allowFreeText).
 *   3. onChange fires only from an explicit row click, never from closing.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@forma360/i18n/messages/en';

vi.mock('../../lib/permissions-context', () => ({
  useHasPermission: () => false,
}));

// The invite affordance is out of scope here (and pulls its own queries).
vi.mock('./invite-user-dialog', () => ({
  InviteUserDialog: () => null,
}));

vi.mock('../../lib/trpc/client', () => ({
  trpc: {
    users: {
      list: {
        useQuery: () => ({
          data: {
            users: [
              { id: '01BAIRDBAIRDBAIRDBAIRD0001', name: 'Tom Baird', email: 'tom@example.com' },
            ],
            hasMore: false,
          },
          isFetching: false,
        }),
      },
    },
  },
}));

import { UserPicker } from './user-picker';

afterEach(cleanup);

const messages = {
  userPicker: (en as Record<string, unknown>)['userPicker'],
};

function mount(allowFreeText: boolean) {
  const onChange = vi.fn();
  render(
    <NextIntlClientProvider locale="en" timeZone="Europe/London" messages={messages}>
      <UserPicker value={null} onChange={onChange} allowFreeText={allowFreeText} />
    </NextIntlClientProvider>,
  );
  return { onChange };
}

function openPicker(): HTMLInputElement {
  fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
  return screen.getByRole('textbox') as HTMLInputElement;
}

describe('UserPicker (NR3-02)', () => {
  it('hides rows that do not match the live typed text — before any debounce/refetch', () => {
    mount(false);
    const input = openPicker();

    // The stale first page shows initially.
    expect(screen.getByText('Tom Baird')).toBeDefined();

    // Typing a non-matching name removes the row IMMEDIATELY.
    fireEvent.change(input, { target: { value: 'Grace Adeyemi (NEBOSH Dip)' } });
    expect(screen.queryByText('Tom Baird')).toBeNull();
  });

  it('offers the typed text as a free-text row when allowed, and picks exactly it', () => {
    const { onChange } = mount(true);
    const input = openPicker();
    fireEvent.change(input, { target: { value: 'Grace Adeyemi (NEBOSH Dip)' } });

    const freeText = screen.getByText(/Grace Adeyemi \(NEBOSH Dip\)/);
    fireEvent.click(freeText);
    expect(onChange).toHaveBeenCalledWith({ userId: null, name: 'Grace Adeyemi (NEBOSH Dip)' });
  });

  it('still shows matching rows while typing, and picking one is explicit', () => {
    const { onChange } = mount(false);
    const input = openPicker();
    fireEvent.change(input, { target: { value: 'tom' } });

    fireEvent.click(screen.getByText('Tom Baird'));
    expect(onChange).toHaveBeenCalledWith({
      userId: '01BAIRDBAIRDBAIRDBAIRD0001',
      name: 'Tom Baird',
    });
  });

  it('trusts the server rows once the fetch for the typed query has settled', async () => {
    // users.list matches on more than the display name (raw `name` column,
    // BUG-20): a settled result must render even when the displayed name
    // does not contain the typed text — re-filtering it would make users
    // with diverged name/firstName unfindable.
    vi.useFakeTimers();
    try {
      mount(false);
      const input = openPicker();
      // 'david' matches Tom Baird's raw name server-side in this scenario
      // (the mock returns him); it does NOT match the displayed name.
      fireEvent.change(input, { target: { value: 'david' } });
      expect(screen.queryByText('Tom Baird')).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByText('Tom Baird')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
