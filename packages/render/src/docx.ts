/**
 * Word (.docx) renderer. Phase 2 PR 31.
 *
 * Pure JS — the `docx` npm package assembles a valid Office Open XML
 * document in-process. No chromium, no native binaries. Output is
 * cached in R2 under
 * `<tenantId>/inspections/<inspectionId>/docx-<sha256>.docx` keyed on
 * {@link hashInspectionSnapshot} so a stable inspection re-renders to
 * the same key.
 */
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import {
  loadInspectionSnapshot,
  hashInspectionSnapshot,
  type InspectionRenderSnapshot,
} from './snapshot';
import type { Database } from '@forma360/db/client';
import type { Storage } from '@forma360/shared/storage';

export interface RenderDocxDeps {
  db: Database;
  storage: Storage;
}

export interface RenderDocxResult {
  key: string;
  bytes: number;
  cached: boolean;
}

export async function renderInspectionDocx(
  deps: RenderDocxDeps,
  input: { tenantId: string; inspectionId: string },
): Promise<RenderDocxResult> {
  const snap = await loadInspectionSnapshot(deps.db, input);
  if (snap === null) {
    throw new Error(`Inspection not found: ${input.inspectionId}`);
  }
  const hash = hashInspectionSnapshot(snap);
  const key = docxObjectKey(input.tenantId, input.inspectionId, hash);

  const buffer = await buildDocxBuffer(snap);
  await uploadDocx(deps, { key, bytes: buffer });

  return { key, bytes: buffer.length, cached: false };
}

export function docxObjectKey(tenantId: string, inspectionId: string, hash: string): string {
  return `${tenantId}/inspections/${inspectionId}/docx-${hash}.docx`;
}

async function buildDocxBuffer(snap: InspectionRenderSnapshot): Promise<Uint8Array> {
  const children: Array<Paragraph | Table> = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: snap.inspection.title })],
    }),
  );

  if (snap.inspection.documentNumber !== null) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Document: ', bold: true }),
          new TextRun({ text: snap.inspection.documentNumber }),
        ],
      }),
    );
  }
  children.push(
    new Paragraph({
      children: [
        new TextRun({ text: 'Status: ', bold: true }),
        new TextRun({ text: snap.inspection.status }),
      ],
    }),
  );
  if (snap.inspection.completedAt !== null) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: 'Completed: ', bold: true }),
          new TextRun({ text: snap.inspection.completedAt }),
        ],
      }),
    );
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: 'Responses' })],
    }),
  );

  // Responses come through as keyed-by-item-id JSON. We render each
  // template item as a heading with its prompt and the answer below.
  // The full template schema is a union of 12+ item types; we
  // stringify unknown shapes rather than failing.
  const content = snap.template.content as TemplateContentLike | undefined;
  if (content !== undefined && Array.isArray(content.pages)) {
    for (const page of content.pages) {
      if (page.type === 'title') continue;
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: String(page.title ?? '') })],
        }),
      );
      for (const section of page.sections ?? []) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: String(section.title ?? '') })],
          }),
        );
        for (const item of section.items ?? []) {
          const prompt = String((item as { prompt?: unknown }).prompt ?? item.id ?? '');
          const itemId = String(item.id ?? '');
          const response = snap.inspection.responses[itemId];
          children.push(
            new Paragraph({
              children: [new TextRun({ text: prompt, bold: true })],
            }),
          );
          children.push(
            new Paragraph({
              children: [new TextRun({ text: stringifyResponse(response) })],
            }),
          );
        }
      }
    }
  }

  if (snap.signatures.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'Signatures' })],
      }),
    );
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: ['Slot', 'Signer', 'Role', 'Signed at'].map(
              (h) =>
                new TableCell({
                  children: [
                    new Paragraph({ children: [new TextRun({ text: h, bold: true })] }),
                  ],
                }),
            ),
          }),
          ...snap.signatures.map(
            (s) =>
              new TableRow({
                children: [
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun({ text: String(s.slotIndex + 1) })] }),
                    ],
                  }),
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: s.signerName })] })],
                  }),
                  new TableCell({
                    children: [
                      new Paragraph({ children: [new TextRun({ text: s.signerRole ?? '' })] }),
                    ],
                  }),
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: s.signedAt })] })],
                  }),
                ],
              }),
          ),
        ],
      }),
    );
  }

  if (snap.approvals.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text: 'Approvals' })],
      }),
    );
    for (const a of snap.approvals) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${a.decision} by ${a.approverUserId} at ${a.decidedAt}` }),
          ],
        }),
      );
      if (a.comment !== null) {
        children.push(
          new Paragraph({ children: [new TextRun({ text: a.comment, italics: true })] }),
        );
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}

function stringifyResponse(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '[unserialisable]';
  }
}

async function uploadDocx(
  deps: RenderDocxDeps,
  input: { key: string; bytes: Uint8Array },
): Promise<void> {
  const url = await deps.storage.getSignedUploadUrl({
    key: input.key,
    contentType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    expiresInSeconds: 60 * 5,
  });
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    // Uint8Array is valid BodyInit at runtime; cast to bypass the
    // Next lib-dom strictness.
    body: input.bytes as unknown as ReadableStream,
  });
  if (!res.ok) {
    throw new Error(`R2 upload failed: ${res.status} ${res.statusText}`);
  }
}

// Narrow shape used to walk the template content without importing the
// full Zod schema (which would pull all Phase 2 item types in). The
// full shape is validated on publish.
interface TemplateContentLike {
  pages?: ReadonlyArray<{
    type?: string;
    title?: string;
    sections?: ReadonlyArray<{
      title?: string;
      items?: ReadonlyArray<{ id?: string; prompt?: string }>;
    }>;
  }>;
}
