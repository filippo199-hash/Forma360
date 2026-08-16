'use client';

/**
 * The client's view of an issued RAMS pack, reached by an opaque share
 * link with no login. Renders the frozen version exactly as issued, then
 * offers the two decisions a client actually makes: accept, or request
 * changes.
 *
 * Possession of the token IS the permission check (ADR 0008), so the
 * decision form posts back through the same public procedure that served
 * the read — the server re-validates revocation and expiry on write.
 *
 * Not translated: the recipient is an external client with no session
 * and no locale preference we know, and the pack content itself is
 * whatever language the contractor authored it in. Same stance as the
 * print layouts.
 */
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { RamsPrintLayout, type PrintableRamsSnapshot } from './rams-print-layout';
import { trpc } from '../../lib/trpc/client';
import { serverErrorMessage } from '../../lib/server-error';

export function RamsClientAcceptanceView({
  snapshot,
  token,
  alreadyDecided,
}: {
  // RS-A14: the tenant id is typed away, so the page cannot serialise
  // an internal identifier into a payload an external client can read.
  snapshot: PrintableRamsSnapshot;
  token: string;
  alreadyDecided: { decision: string; acceptedByName: string } | null;
}) {
  // The public layout mounts the English-only `PublicIntlProvider`, so
  // a server refusal ('link-revoked', 'decision-already-recorded', …)
  // renders as the catalogue's sentence, never the raw guard key.
  const tErrors = useTranslations('serverErrors');

  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [comment, setComment] = useState('');
  const [done, setDone] = useState<string | null>(alreadyDecided?.decision ?? null);

  const decide = trpc.rams.client.publicDecide.useMutation({
    onSuccess: (_result, variables) => setDone(variables.decision),
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <RamsPrintLayout snapshot={snapshot} />

      <section className="mt-8 rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Your decision</h2>

        {done !== null ? (
          <p className="mt-2 text-sm">
            {done === 'accepted'
              ? 'This pack has been accepted. Thank you.'
              : 'Changes have been requested. The contractor has been notified.'}
            {alreadyDecided !== null && alreadyDecided.acceptedByName.length > 0
              ? ` (${alreadyDecided.acceptedByName})`
              : ''}
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-600">
              Confirm you have read this risk assessment and method statement and are content for
              the work to proceed as described, or request changes.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block font-medium">Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 w-full rounded-md border px-3 text-sm"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Organisation</span>
                <input
                  value={organisation}
                  onChange={(e) => setOrganisation(e.target.value)}
                  className="h-9 w-full rounded-md border px-3 text-sm"
                />
              </label>
            </div>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Comment (optional)</span>
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>

            {decide.error !== null ? (
              <p className="mt-2 text-sm text-red-700">
                {serverErrorMessage(
                  decide.error,
                  tErrors as (k: string) => string,
                  'Something went wrong recording your decision. Please try again.',
                )}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={name.trim().length === 0 || decide.isPending}
                onClick={() =>
                  decide.mutate({
                    token,
                    decision: 'accepted',
                    acceptedByName: name.trim(),
                    acceptedByOrganisation: organisation.trim(),
                    comment: comment.trim(),
                  })
                }
                className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={name.trim().length === 0 || decide.isPending}
                onClick={() =>
                  decide.mutate({
                    token,
                    decision: 'changes_requested',
                    acceptedByName: name.trim(),
                    acceptedByOrganisation: organisation.trim(),
                    comment: comment.trim(),
                  })
                }
                className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                Request changes
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
