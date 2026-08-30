/**
 * NR-12 regression pin — the logbook must fit a 390px phone.
 *
 * The shipped trap: six columns plus an inline 220px asset SearchSelect
 * pushed the check table's intrinsic width to ~700px. The wrapper's
 * overflow-x-auto meant the PAGE didn't scroll — instead the next-due
 * date, status chip and the Record button were clipped behind an
 * intra-card scroll with no affordance, which a tester reports as
 * "overflow". jsdom cannot measure layout, so this pins the responsive
 * markers themselves: secondary columns and the inline asset select are
 * desktop-only, while Check / Next due / Status / Record stay visible.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@forma360/i18n/messages/en';

vi.mock('../../lib/permissions-context', () => ({
  useHasPermission: () => true,
}));

vi.mock('../../lib/trpc/client', () => ({
  trpc: {
    useUtils: () => ({ assets: { list: { invalidate: () => undefined } } }),
    assets: {
      list: { useQuery: () => ({ data: { assets: [] } }) },
    },
    fireSafety: {
      logbook: {
        updateCheck: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
        // Round-4 history query — disabled by default in the component.
        entries: { useQuery: () => ({ data: undefined, isLoading: false }) },
      },
    },
  },
}));

import { LogbookTab, type LogbookCheckRow } from './logbook-tab';
import { TooltipProvider } from '../ui/tooltip';

afterEach(cleanup);

const messages = {
  fireSafety: (en as Record<string, unknown>)['fireSafety'],
  offline: (en as Record<string, unknown>)['offline'],
  // SearchSelect's own namespace — without it the render logs a warning.
  entitySelect: (en as Record<string, unknown>)['entitySelect'],
};

const fireSafetyEn = en.fireSafety;

const check: LogbookCheckRow = {
  id: '01CHECKCHECKCHECKCHECK0001',
  checkType: 'alarm_test',
  label: '',
  frequency: 'weekly',
  active: true,
  assetId: null,
  lastDoneAt: null,
  nextDueAt: new Date('2026-08-01T12:00:00Z'),
  dueStatus: 'overdue',
};

function mount() {
  render(
    <NextIntlClientProvider locale="en" timeZone="Europe/London" messages={messages}>
      <TooltipProvider>
        <LogbookTab
          buildingId="01BUILDINGBUILDINGBUILD001"
          locale="en"
          archived={false}
          checks={[check]}
          recentEntries={[]}
          onInvalidate={() => undefined}
        />
      </TooltipProvider>
    </NextIntlClientProvider>,
  );
}

describe('LogbookTab responsive layout (NR-12)', () => {
  it('hides the Frequency and Last done columns below md', () => {
    mount();
    const frequency = screen.getByText(fireSafetyEn.logbook.columns.frequency);
    const lastDone = screen.getByText(fireSafetyEn.logbook.columns.lastDone);
    for (const th of [frequency, lastDone]) {
      expect(th.className).toContain('hidden');
      expect(th.className).toContain('md:table-cell');
    }
  });

  it('renders the inline asset select desktop-only; the edit dialog stays the mobile path', () => {
    mount();
    // The SearchSelect trigger shows the no-linked-asset placeholder; its
    // wrapper is the responsive gate.
    const trigger = screen.getByText(fireSafetyEn.logbook.noLinkedAsset);
    const gate = trigger.closest('div.hidden');
    expect(gate).not.toBeNull();
    expect(gate?.className).toContain('md:block');
  });

  it('keeps Check, Next due, Status and the Record button visible at every width', () => {
    mount();
    const record = screen.getByText(fireSafetyEn.logbook.recordButton);
    expect(record.closest('td')?.className ?? '').not.toContain('hidden');
    const nextDue = screen.getByText(fireSafetyEn.logbook.columns.nextDue);
    const status = screen.getByText(fireSafetyEn.logbook.columns.status);
    for (const th of [nextDue, status]) {
      expect(th.className).not.toContain('hidden');
    }
  });
});
