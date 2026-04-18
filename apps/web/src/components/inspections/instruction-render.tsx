/**
 * Minimal instruction-item renderer.
 *
 * PR 29 renders instruction bodies as a whitespace-preserving `<pre>` —
 * safe (no HTML injection, no third-party markdown parser) and good
 * enough for the short prose instructions the editor currently produces.
 * Full Markdown rendering is a later PR (see TODO in component).
 */
export function InstructionBody({ body }: { body: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-sm leading-relaxed">
      {body}
    </pre>
  );
}
