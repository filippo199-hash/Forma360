/**
 * Knowledge-document upload for one AI agent (admin only).
 *
 * Unlike the attachment routes this endpoint does BOTH halves — blob and
 * metadata row — because extraction is a server concern: the file is
 * stored, its text is extracted ONCE (Claude reads PDFs and photos
 * natively, text files are decoded — see `ai-knowledge.ts`), and the row
 * lands in `ai_agent_knowledge_files` with the text agents will actually
 * use. A failed extraction stores the row with `status: 'failed'` so the
 * admin can see the document contributed nothing and delete it.
 *
 * Storage key layout: `<tenantId>/ai-knowledge/<fileId>/<filename>` —
 * the row id is the entity segment (agent ids are slugs, not ULIDs).
 *
 * Auth: session + `org.settings` (the who-edits decision: admins teach
 * agents). Rate-limited per user because every PDF/photo upload runs an
 * extraction call.
 */
import { AI_KNOWLEDGE_LIMITS, isAiAgentId } from '@forma360/shared/ai-agents';
import { aiAgentKnowledgeFiles } from '@forma360/db/schema';
import { loadUserPermissions } from '@forma360/permissions/requirePermission';
import { newId } from '@forma360/shared/id';
import { objectKey } from '@forma360/shared/storage';
import { PHONE_IMAGE_MIME, resolveUploadMime } from '@forma360/shared/upload-media';
import { and, count, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  extractKnowledgeText,
  isKnowledgeMimeSupported,
} from '../../../../src/server/ai-knowledge';
import { TENANT_DAILY_AI_LIMIT } from '../../../../src/server/task-agent';
import { env } from '../../../../src/server/env';
import { normalisePhoneMedia } from '../../../../src/server/phone-media';
import { rateLimit, tooManyRequests } from '../../../../src/server/rate-limit';
import { storage } from '../../../../src/server/storage';
import { createContext } from '../../../../src/server/trpc';
import { storageThrew } from '../../../../src/server/upload-failure';

// Extraction runs a full model read per document; extraction time also
// bounds how long the admin waits, so photos and PDFs share one cap.
const ACCEPTED_MIME = new Set<string>([
  'application/pdf',
  'text/plain',
  'text/csv',
  ...PHONE_IMAGE_MIME,
]);
const FILENAME_SAFE = /[^A-Za-z0-9._-]/g;

function sanitizeFilename(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, '_');
  const cleaned = trimmed.replace(FILENAME_SAFE, '_');
  const timestamp = Date.now().toString(36);
  return `${timestamp}_${cleaned || 'document'}`.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const hdrs = await headers();
  const ctx = await createContext({ headers: hdrs });
  if (ctx.auth === null) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const perms = await loadUserPermissions(ctx.db, ctx.auth.tenantId, ctx.auth.userId);
  if (!perms.includes('org.settings')) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const rl = await rateLimit(`ai:knowledge-upload:${ctx.auth.userId}`, {
    limit: 10,
    windowSec: 300,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const tenantRl = await rateLimit(`ai:tenant-day:${ctx.auth.tenantId}`, {
    limit: TENANT_DAILY_AI_LIMIT,
    windowSec: 86_400,
  });
  if (!tenantRl.ok) return tooManyRequests(tenantRl.retryAfterSec);

  const form = await req.formData();
  const agentId = String(form.get('agentId') ?? '');
  const file = form.get('file');
  if (!isAiAgentId(agentId) || !(file instanceof File)) {
    return NextResponse.json({ error: 'BAD_REQUEST' }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: 'EMPTY_FILE' }, { status: 400 });
  }
  if (file.size > AI_KNOWLEDGE_LIMITS.fileBytes) {
    return NextResponse.json({ error: 'FILE_TOO_LARGE' }, { status: 400 });
  }
  const resolvedMime = resolveUploadMime(file.name, file.type);
  if (resolvedMime === null || !ACCEPTED_MIME.has(resolvedMime)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }

  const [existing] = await ctx.db
    .select({ n: count() })
    .from(aiAgentKnowledgeFiles)
    .where(
      and(
        eq(aiAgentKnowledgeFiles.tenantId, ctx.auth.tenantId),
        eq(aiAgentKnowledgeFiles.agentId, agentId),
      ),
    );
  if ((existing?.n ?? 0) >= AI_KNOWLEDGE_LIMITS.maxFiles) {
    return NextResponse.json({ error: 'TOO_MANY_FILES' }, { status: 400 });
  }

  // HEIC photos of paperwork are a legitimate knowledge source — convert
  // to JPEG so the extractor (and any later preview) can read them.
  const media = await normalisePhoneMedia(
    {
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: resolvedMime,
      filename: sanitizeFilename(file.name),
    },
    ctx.logger,
  );
  if (!isKnowledgeMimeSupported(media.mimeType)) {
    return NextResponse.json({ error: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
  }

  const fileId = newId();
  const key = objectKey({
    tenantId: ctx.auth.tenantId as never,
    module: 'ai-knowledge',
    entityId: fileId as never,
    filename: media.filename,
  });

  if (env.NODE_ENV === 'production') {
    try {
      await storage.putObject({ key, contentType: media.mimeType, bytes: media.bytes });
    } catch (err) {
      return storageThrew(ctx.logger, 'ai-knowledge', key, err);
    }
  } else {
    const target = join(process.cwd(), '.local-storage', key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, media.bytes);
  }

  const extracted = await extractKnowledgeText({
    filename: media.filename,
    mimeType: media.mimeType,
    bytes: media.bytes,
  });

  await ctx.db.insert(aiAgentKnowledgeFiles).values({
    id: fileId,
    tenantId: ctx.auth.tenantId,
    agentId,
    filename: media.filename,
    storageKey: key,
    mimeType: media.mimeType,
    sizeBytes: media.bytes.length,
    extractedText: extracted ?? '',
    status: extracted === null ? 'failed' : 'ready',
    createdBy: ctx.auth.userId,
  });

  return NextResponse.json({
    id: fileId,
    filename: media.filename,
    mimeType: media.mimeType,
    sizeBytes: media.bytes.length,
    status: extracted === null ? 'failed' : 'ready',
  });
}
