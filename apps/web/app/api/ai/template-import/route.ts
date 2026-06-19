import { headers } from 'next/headers';
import { auth } from '../../../../src/server/auth';
import { convertFileToSpec } from '../../../../src/server/template-import';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = (session.user as Record<string, unknown>)['tenantId'];
  if (typeof tenantId !== 'string') {
    return Response.json({ error: 'No tenant' }, { status: 403 });
  }

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get('file');
    if (value instanceof File) file = value;
  } catch {
    return Response.json({ error: 'Bad request' }, { status: 400 });
  }
  if (file === null) {
    return Response.json({ error: 'No file provided' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: 'File too large (max 20 MB).' }, { status: 413 });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const spec = await convertFileToSpec({
      filename: file.name,
      mimeType: file.type,
      bytes,
    });
    return Response.json({ spec });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Could not convert the file.' },
      { status: 422 },
    );
  }
}
