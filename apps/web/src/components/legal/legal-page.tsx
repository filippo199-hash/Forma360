import type { LegalDoc } from '../../content/legal';

/**
 * Renders a {@link LegalDoc} (privacy, terms, data deletion) as a readable,
 * accessible long-form page. All copy comes from the data object, so no
 * hardcoded user-facing strings live here.
 */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      <header className="mb-8 border-b pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{doc.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {doc.updated}</p>
      </header>

      {doc.intro.map((p, i) => (
        <p key={`intro-${i}`} className="mb-4 leading-relaxed text-muted-foreground">
          {p}
        </p>
      ))}

      <div className="mt-8 space-y-8">
        {doc.sections.map((section, si) => (
          <section key={`section-${si}`}>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">{section.heading}</h2>
            {section.body?.map((p, pi) => (
              <p key={`p-${si}-${pi}`} className="mb-3 leading-relaxed text-muted-foreground">
                {p}
              </p>
            ))}
            {section.bullets ? (
              <ul className="mt-2 list-disc space-y-1.5 pl-6 text-muted-foreground">
                {section.bullets.map((b, bi) => (
                  <li key={`b-${si}-${bi}`} className="leading-relaxed">
                    {b}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </article>
  );
}
