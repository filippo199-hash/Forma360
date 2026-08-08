/**
 * The `heads_up_documents → documents` join, made visibility-aware.
 *
 * The 8 August 2026 Heads-Up audit found this join in four places and
 * wrong in all four (HU-D01..HU-D04): a briefing that attaches a library
 * document disclosed that document's **existence and title** to anyone who
 * could read the briefing, regardless of the document's own visibility
 * rules. The projection carries no `storageKey`, so the file's *content*
 * stayed protected — opening it still goes through `documents.get`, which
 * enforces visibility correctly. What escaped was metadata, and for this
 * class of document the title is frequently the sensitive part
 * ("Redundancy consultation — night shift").
 *
 * Documents' own access layer was never the problem; it was being bypassed
 * from outside. So the fix is one loader that every reader shares, rather
 * than four filters that can drift apart:
 *
 *   - `headsUps.get`            — author / manager view (HU-D02)
 *   - `headsUps.getForRecipient` — recipient view (HU-D01)
 *   - `/s/[token]`               — public share link, no viewer (HU-D04)
 *
 * `headsUps.create` closes the fourth (HU-D03) by refusing the attachment
 * outright, which is cheaper and safer than filtering it on the way out.
 */
import { documents, headsUpDocuments } from '@forma360/db/schema';
import { and, eq } from 'drizzle-orm';
import { makeDocumentVisibilityFilter } from './routers/document-visibility';

/** What a reader is allowed to know about an attached library document. */
export interface HeadsUpLibraryDocument {
  documentId: string;
  documentVersion: number;
  name: string;
  mimeType: string;
}

export interface HeadsUpDocumentViewer {
  /**
   * The reader, or `null` for an anonymous one (the public share link).
   * An anonymous viewer belongs to no group and no site, so only a
   * genuinely unrestricted document survives the filter.
   */
  userId: string | null;
  /**
   * Set for a caller holding `documents.manage`, who sees every document
   * in the library anyway — filtering them here would hide from the
   * briefing page what `documents.list` shows them one click away.
   */
  seesEveryDocument?: boolean;
}

interface JoinedRow extends HeadsUpLibraryDocument {
  folderId: string | null;
  visibleToGroupIds: unknown;
  visibleToSiteIds: unknown;
}

function project(row: JoinedRow): HeadsUpLibraryDocument {
  return {
    documentId: row.documentId,
    documentVersion: row.documentVersion,
    name: row.name,
    mimeType: row.mimeType,
  };
}

/**
 * The library documents attached to a briefing that `viewer` is entitled
 * to know about. Always tenant-scoped on both sides of the join.
 */
export async function loadHeadsUpLibraryDocuments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  tenantId: string,
  headsUpId: string,
  viewer: HeadsUpDocumentViewer,
): Promise<HeadsUpLibraryDocument[]> {
  const rows = (await db
    .select({
      documentId: headsUpDocuments.documentId,
      documentVersion: headsUpDocuments.documentVersion,
      name: documents.name,
      mimeType: documents.mimeType,
      folderId: documents.folderId,
      visibleToGroupIds: documents.visibleToGroupIds,
      visibleToSiteIds: documents.visibleToSiteIds,
    })
    .from(headsUpDocuments)
    .innerJoin(documents, eq(headsUpDocuments.documentId, documents.id))
    .where(
      and(eq(headsUpDocuments.tenantId, tenantId), eq(headsUpDocuments.headsUpId, headsUpId)),
    )) as JoinedRow[];

  if (rows.length === 0) return [];
  if (viewer.seesEveryDocument === true) return rows.map(project);

  const passes = await makeDocumentVisibilityFilter(db, tenantId, viewer.userId);
  return rows
    .filter((r) =>
      passes({
        id: r.documentId,
        folderId: r.folderId,
        visibleToGroupIds: r.visibleToGroupIds,
        visibleToSiteIds: r.visibleToSiteIds,
      }),
    )
    .map(project);
}
