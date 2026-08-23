/**
 * Designed dead-end for a share link that no longer resolves (UXW3-03).
 *
 * A revoked or expired `/s` token used to fall through to the bare
 * framework 404 — no brand, no explanation — which, for the contractor
 * who yesterday SIGNED the document behind it, reads as "they deleted
 * the evidence". The refusal policy is unchanged (a withdrawn pack is
 * never rendered — RS-E12); only the words are now ours, matching the
 * sibling surfaces (`/scan`, contractor-upload) that already had
 * designed dead-ends.
 *
 * Server component: strings are translated by the caller (Accept-Language
 * negotiation, same as the scan page) and passed down as plain props.
 */
export function ShareLinkDeadEnd({
  brandName,
  title,
  body,
}: {
  brandName: string;
  title: string;
  body: string;
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-sm font-semibold text-muted-foreground">{brandName}</p>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
    </main>
  );
}
