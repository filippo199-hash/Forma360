'use client';

import { CheckCircle2, FileText, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../../src/components/ui/button';
import { Card, CardContent } from '../../../../src/components/ui/card';
import { Skeleton } from '../../../../src/components/ui/skeleton';
import { trpc } from '../../../../src/lib/trpc/client';

export default function ContractorUploadPortal() {
  const t = useTranslations('contractors');
  const params = useParams<{ token: string }>();
  const token = params.token ?? '';

  const { data, isLoading, error } = trpc.contractors.publicByToken.useQuery(
    { token },
    { enabled: token !== '', retry: false },
  );

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function upload(requirementId: string, file: File) {
    setUploadingId(requirementId);
    try {
      const form = new FormData();
      form.append('token', token);
      form.append('requirementId', requirementId);
      form.append('file', file);
      const res = await fetch('/api/contractor-upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('upload-failed');
      setDone((prev) => new Set(prev).add(requirementId));
      toast.success(t('portalUploaded'));
    } catch {
      toast.error(t('error'));
    } finally {
      setUploadingId(null);
    }
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-lg px-4 py-10">
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : error !== null || data === undefined ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('portalInvalid')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">{t('portalTitle')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('portalIntro', { name: data.contractorName })}
            </p>
          </header>

          <div className="space-y-3">
            {data.requirements.map((r) => {
              const isDone = done.has(r.id);
              return (
                <Card key={r.id}>
                  <CardContent className="flex items-center gap-3 p-4">
                    <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.name}</span>
                    {isDone ? (
                      <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
                        <CheckCircle2 className="h-4 w-4" />
                        {t('portalDone')}
                      </span>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={uploadingId !== null}
                          onClick={() => fileRefs.current[r.id]?.click()}
                        >
                          <Upload className="mr-1 h-3.5 w-3.5" />
                          {uploadingId === r.id ? t('uploading') : t('portalUpload')}
                        </Button>
                        <input
                          ref={(el) => {
                            fileRefs.current[r.id] = el;
                          }}
                          type="file"
                          accept=".pdf,.png,.jpg,.jpeg,.webp"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f !== undefined) void upload(r.id, f);
                            e.target.value = '';
                          }}
                        />
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
