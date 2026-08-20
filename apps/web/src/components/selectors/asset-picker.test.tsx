/**
 * AssetPicker behaviour (AS-PK01..PK05).
 *
 * The picker replaced a native `<select>` listing every asset in the tenant,
 * flat, in one scroll. What has to be true of the replacement:
 *
 *   1. Browsing shows top-level assets only, and does not drag in the whole
 *      register (PK01) — the point of the change.
 *   2. Sub-assets are reachable, and reachable ONLY through their parent's
 *      expander, so the hierarchy is visible rather than flattened (PK02).
 *   3. A parent and its child are separately selectable — attaching an action
 *      to the mill and to the mill's spindle are different claims (PK03).
 *   4. Typing searches server-side across both levels (PK04).
 *   5. NR3-02: a row that does not match the LIVE typed text is not offered,
 *      because the debounce plus fetch lets stale rows sit exactly where the
 *      next click lands (PK05).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@forma360/i18n/messages/en';

const MILL = {
  id: '01MILLMILLMILLMILLMILL0001',
  name: 'CNC Mill 03',
  parentId: null,
  parentName: null,
  typeName: 'Machine tool',
  childrenCount: 1,
};
const GRINDER = {
  id: '01GRINDERGRINDERGRIND0001',
  name: 'Bench grinder',
  parentId: null,
  parentName: null,
  typeName: 'Machine tool',
  childrenCount: 0,
};
const SPINDLE = {
  id: '01SPINDLESPINDLESPIN0001',
  name: 'Spindle motor',
  parentId: MILL.id,
  parentName: MILL.name,
  typeName: 'Motor',
  childrenCount: 0,
};

/** Every call the component made, so the test can assert what it asked for. */
const calls: Array<Record<string, unknown>> = [];

vi.mock('../../lib/trpc/client', () => ({
  trpc: {
    assets: {
      list: {
        useQuery: (input: Record<string, unknown>) => {
          calls.push(input);
          // Mirrors the server: parentId null = top level, parentId set =
          // that parent's children, search = flat across both levels.
          if (typeof input['search'] === 'string') {
            const needle = (input['search'] as string).toLowerCase();
            return {
              data: {
                assets: [MILL, GRINDER, SPINDLE].filter((a) =>
                  a.name.toLowerCase().includes(needle),
                ),
                hasMore: false,
              },
              isFetching: false,
              isPending: false,
            };
          }
          if (typeof input['parentId'] === 'string') {
            return {
              data: { assets: [SPINDLE], hasMore: false },
              isFetching: false,
              isPending: false,
            };
          }
          return {
            data: { assets: [MILL, GRINDER], hasMore: false },
            isFetching: false,
            isPending: false,
          };
        },
      },
    },
  },
}));

import { AssetPicker } from './asset-picker';

afterEach(() => {
  cleanup();
  calls.length = 0;
});

const messages = { assetPicker: (en as Record<string, unknown>)['assetPicker'] };

function mount(selectedIds: string[] = []) {
  const onToggle = vi.fn();
  render(
    <NextIntlClientProvider locale="en" timeZone="Europe/London" messages={messages}>
      <AssetPicker selectedIds={selectedIds} onToggle={onToggle} placeholder="No asset" />
    </NextIntlClientProvider>,
  );
  // Opening the popover is the first button on the page.
  fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);
  return { onToggle };
}

describe('AssetPicker', () => {
  it('AS-PK01: browsing lists top-level assets only, and asks the server for just those', () => {
    mount();

    expect(screen.getByText('CNC Mill 03')).toBeDefined();
    expect(screen.getByText('Bench grinder')).toBeDefined();
    // The sub-asset is NOT in the browse list — that is the flat dump this
    // component exists to stop.
    expect(screen.queryByText('Spindle motor')).toBeNull();
    expect(calls.some((c) => c['parentId'] === null)).toBe(true);
  });

  it('AS-PK02: a parent with sub-assets expands to reveal them; a leaf offers no expander', () => {
    mount();

    // One expander on the page: the mill's. The grinder has childrenCount 0.
    const expanders = screen.getAllByRole('button', { name: 'Show sub-assets' });
    expect(expanders).toHaveLength(1);

    fireEvent.click(expanders[0] as HTMLElement);
    expect(screen.getByText('Spindle motor')).toBeDefined();
    expect(calls.some((c) => c['parentId'] === MILL.id)).toBe(true);
  });

  it('AS-PK03: parent and child are each selectable in their own right', () => {
    const { onToggle } = mount();

    // Clicking the parent's NAME selects the parent — it does not merely
    // expand it. Attaching to the mill is a legitimate, different claim.
    fireEvent.click(screen.getByText('CNC Mill 03'));
    expect(onToggle).toHaveBeenCalledWith(MILL.id, true);

    fireEvent.click(screen.getByRole('button', { name: 'Show sub-assets' }));
    fireEvent.click(screen.getByText('Spindle motor'));
    expect(onToggle).toHaveBeenCalledWith(SPINDLE.id, true);
  });

  it('AS-PK04: typing searches across both levels and names the parent of a hit', () => {
    vi.useFakeTimers();
    try {
      mount();
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: 'Spindle motor' } });
      // Search is debounced, and until it fires the picker is still browsing;
      // the query only goes out on the far side of the delay.
      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(calls.some((c) => c['search'] === 'Spindle motor')).toBe(true);
      expect(screen.getByText('Spindle motor')).toBeDefined();
      // The hit says which machine it belongs to — "Spindle motor" alone is
      // three different objects in a workshop with three mills.
      expect(screen.getByText('in CNC Mill 03')).toBeDefined();
      // A search is already flat across both levels, so it offers no
      // expanders that would re-list what the results already show.
      expect(screen.queryByRole('button', { name: 'Show sub-assets' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('AS-PK05: a row that does not match the live typed text is never offered', () => {
    mount();
    const input = screen.getByRole('textbox');

    // Before the 250ms debounce fires, the rendered rows are still the
    // browse page. They must disappear the instant they stop matching.
    fireEvent.change(input, { target: { value: 'Spindle' } });
    expect(screen.queryByText('CNC Mill 03')).toBeNull();
    expect(screen.queryByText('Bench grinder')).toBeNull();
  });

  it('AS-PK06: an already-attached asset is toggled off rather than added twice', () => {
    const { onToggle } = mount([MILL.id]);

    fireEvent.click(screen.getByText('CNC Mill 03'));
    expect(onToggle).toHaveBeenCalledWith(MILL.id, false);
  });
});
