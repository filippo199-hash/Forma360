/**
 * Print layout for the Puppeteer-facing `/render/drill/*` route — one
 * fire drill as a branded, filable logbook page: when it ran, who ran
 * it, the evacuation time, the muster roll and the lessons learned.
 * English-only like the other print layouts: the rendered artefact is a
 * portable record, not a localised screen.
 *
 * Branding: the tenant's company logo and palette (ADR 0018) render in
 * the header — the same branding the inspection print layout applies.
 */
import type { DrillRenderSnapshot } from '@forma360/render';
import { CompanyLetterhead } from '../company-letterhead';

export interface DrillPrintBranding {
  /** Resolved (signed) logo URL, or null when the tenant has none. */
  logoUrl: string | null;
  primaryColor?: string;
  accentColor?: string;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

function timeOfDay(iso: string): string {
  return iso.slice(11, 16);
}

/** mm:ss from a seconds count. */
function evacuationTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 700, fontSize: 11 }}>{label}</div>
      <div>{value}</div>
    </div>
  );
}

function Narrative({ label, text }: { label: string; text: string }) {
  if (text.length === 0) return null;
  return (
    <section style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 13, borderBottom: '1px solid #999', paddingBottom: 2 }}>{label}</h2>
      <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
    </section>
  );
}

export function DrillPrintLayout({
  snapshot,
  branding = null,
}: {
  snapshot: DrillRenderSnapshot;
  branding?: DrillPrintBranding | null;
}) {
  const { drill, building } = snapshot;
  const primary = branding?.primaryColor ?? '#111';
  const accent = branding?.accentColor ?? primary;

  return (
    <main
      style={{
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontSize: 12,
        color: '#111',
        padding: '28px 32px',
        maxWidth: 780,
      }}
    >
      {/* The letterhead carries the company name, logo and details — the
          header used to hand-roll the name + logo half of it. */}
      <CompanyLetterhead company={snapshot.company} logoUrl={branding?.logoUrl ?? null} />
      <header style={{ borderBottom: `2px solid ${primary}`, paddingBottom: 10, marginBottom: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
          Fire safety logbook
        </div>
        <h1 style={{ fontSize: 20, margin: '2px 0 4px', color: primary }}>Fire drill record</h1>
        <div style={{ fontSize: 11, color: '#444' }}>
          {building.name}
          {building.address.length > 0 ? ` · ${building.address}` : ''}
        </div>
      </header>

      <section style={{ display: 'flex', gap: 24, marginBottom: 12 }}>
        <Field label="Date held" value={day(drill.conductedAt)} />
        <Field label="Time" value={timeOfDay(drill.conductedAt)} />
        <Field label="Conducted by" value={drill.conductedByName ?? '—'} />
      </section>

      <section
        style={{
          border: `2px solid ${accent}`,
          padding: '8px 12px',
          marginBottom: 12,
          display: 'flex',
          gap: 24,
        }}
      >
        <Field
          label="Evacuation time"
          value={drill.evacuationSeconds !== null ? evacuationTime(drill.evacuationSeconds) : '—'}
        />
        <Field
          label="Target"
          value={
            drill.evacuationTargetSeconds !== null
              ? evacuationTime(drill.evacuationTargetSeconds)
              : '—'
          }
        />
        <Field
          label="People present"
          value={drill.peoplePresent !== null ? String(drill.peoplePresent) : '—'}
        />
        <Field
          label="Accounted for at muster"
          value={drill.peopleAccountedFor !== null ? String(drill.peopleAccountedFor) : '—'}
        />
        <Field label="Roll call complete" value={drill.rollComplete ? 'Yes' : 'No'} />
      </section>

      <Narrative label="Notes" text={drill.notes} />
      <Narrative label="Lessons learned" text={drill.lessonsLearned} />

      <footer style={{ borderTop: `2px solid ${primary}`, paddingTop: 8, marginTop: 16 }}>
        <p style={{ fontSize: 10, color: '#555', margin: 0 }}>
          Drill recorded {day(drill.createdAt)} · Generated {day(new Date().toISOString())}
        </p>
      </footer>
    </main>
  );
}
