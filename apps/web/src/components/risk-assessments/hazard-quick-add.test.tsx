/**
 * NR-01 regression pin — rapid hazard entry must never lose data.
 *
 * The shipped bug: the quick-add input was `disabled` while a save was in
 * flight. Disabling a focused element blurs it, so in a fast burst only
 * the FIRST hazard ever fired a POST — the rest were typed into a dead
 * input and vanished without an error. Four testers reproduced it; the
 * network layer showed one addHazard call and silence.
 *
 * Pins:
 *   1. A burst of N Enter-commits fires N addHazard mutations — no
 *      serialisation, no swallowed entries.
 *   2. The input is never disabled and keeps focus throughout.
 *   3. A failed save is not silent: the exact text returns to the box.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '@forma360/i18n/messages/en';

const started: string[] = [];
const startedInputs: Array<{ hazard: string; affectedGroups?: string[] }> = [];
const controlsPosted: Array<{ description: string; tier: string }> = [];
let resolvers: Array<() => void> = [];
let failNames: Set<string> = new Set();

vi.mock('../../lib/trpc/client', () => ({
  trpc: {
    riskAssessments: {
      addHazard: {
        useMutation: () => ({
          mutateAsync: (input: { hazard: string; affectedGroups?: string[] }) => {
            started.push(input.hazard);
            startedInputs.push(input);
            return new Promise((resolve, reject) => {
              resolvers.push(() => {
                if (failNames.has(input.hazard)) reject(new Error('boom'));
                else resolve({ hazardId: `h${started.length}` });
              });
            });
          },
        }),
      },
      addControl: {
        useMutation: () => ({
          mutateAsync: (input: { description: string; tier: string }) => {
            controlsPosted.push(input);
            return Promise.resolve({});
          },
        }),
      },
    },
  },
}));

import { HazardQuickAdd } from './hazard-quick-add';

afterEach(() => {
  cleanup();
  started.length = 0;
  startedInputs.length = 0;
  controlsPosted.length = 0;
  resolvers = [];
  failNames = new Set();
});

const messages = { riskAssessments: (en as Record<string, unknown>)['riskAssessments'] };

function mount() {
  const onAdded = vi.fn();
  render(
    <NextIntlClientProvider locale="en" timeZone="Europe/London" messages={messages}>
      <HazardQuickAdd assessmentId="01ARZ3NDEKTSV4RRFFQ69G5FAV" onAdded={onAdded} />
    </NextIntlClientProvider>,
  );
  const input = screen.getByPlaceholderText(
    (messages.riskAssessments as { hazards: { quickAddPlaceholder: string } }).hazards
      .quickAddPlaceholder,
  ) as HTMLInputElement;
  return { input, onAdded };
}

function commit(input: HTMLInputElement, name: string): void {
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('HazardQuickAdd (NR-01)', () => {
  it('fires one mutation per rapid commit — nothing is swallowed while a save is in flight', async () => {
    const { input } = mount();
    input.focus();

    commit(input, 'Slips on wet floor');
    commit(input, 'Falls from ladder');
    commit(input, 'Manual handling strain');
    commit(input, 'Contact with moving parts');
    commit(input, 'Noise exposure');

    // All five POSTs are in flight BEFORE any completes — the old code
    // never got past one.
    expect(started).toEqual([
      'Slips on wet floor',
      'Falls from ladder',
      'Manual handling strain',
      'Contact with moving parts',
      'Noise exposure',
    ]);

    // The box stayed enabled, focused and clear for the next entry.
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);

    resolvers.forEach((settle) => settle());
    await waitFor(() => expect(screen.queryByText(/Saving/)).toBeNull());
  });

  it('restores the typed text into the box when a save fails', async () => {
    const { input } = mount();
    failNames = new Set(['Legionella in water system']);

    commit(input, 'Legionella in water system');
    expect(input.value).toBe('');

    resolvers.forEach((settle) => settle());
    await waitFor(() => expect(input.value).toBe('Legionella in water system'));
  });

  it('keeps later typing when an earlier save fails — the failure is named in a toast instead', async () => {
    const { input } = mount();
    failNames = new Set(['First hazard']);

    commit(input, 'First hazard');
    fireEvent.change(input, { target: { value: 'Second haz' } });

    resolvers.forEach((settle) => settle());
    // The in-progress text must not be overwritten by the restore.
    await waitFor(() => expect(started.length).toBe(1));
    expect(input.value).toBe('Second haz');
  });

  it('picking a care template prefills residents_service_users and its tiered controls', async () => {
    const { input } = mount();
    input.focus();

    // The care persona types the equipment they know — 'hoist' must
    // surface the moving-and-handling-of-people library entry.
    fireEvent.change(input, { target: { value: 'hoist' } });
    const suggestion = await screen.findByText('Moving and handling of people');
    fireEvent.mouseDown(suggestion);

    await waitFor(() => expect(startedInputs.length).toBe(1));
    expect(startedInputs[0]?.hazard).toBe('Moving and handling of people');
    expect(startedInputs[0]?.affectedGroups).toContain('residents_service_users');

    // Settle the addHazard promise so the controls fan-out runs.
    resolvers.forEach((settle) => settle());
    await waitFor(() => expect(controlsPosted.length).toBe(3));
    expect(controlsPosted.map((c) => c.tier)).toContain('engineering');
  });
});
