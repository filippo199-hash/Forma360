'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

/**
 * Hand-rolled signature pad. Pointer events draw on a HiDPI-aware canvas.
 * On "Save" the canvas is serialised as a base64 PNG via `toDataURL()` and
 * passed through the callback — callers wire that straight into
 * `signatures.sign` with the slotIndex / slotId from the pinned version.
 *
 * We deliberately avoid pulling in a signature library (e.g.
 * signature_pad) — the draw loop is short enough that carrying a dep is
 * the wrong trade-off.
 */
export function SignaturePad({
  onSave,
  onClear,
  saving = false,
  defaultName,
}: {
  onSave: (args: { signatureData: string; signerName: string; signerRole?: string }) => void;
  onClear?: () => void;
  saving?: boolean;
  defaultName?: string;
}) {
  const t = useTranslations('inspections.conduct.response.signature');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [signerName, setSignerName] = useState(defaultName ?? '');
  const [signerRole, setSignerRole] = useState('');

  // Set up the canvas at device pixel ratio so ink looks sharp on mobile.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#111';
  }, []);

  function getPoint(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current;
    if (canvas === null) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (canvas === null || ctx === null) return;
    const next = getPoint(e);
    const prev = lastPointRef.current ?? next;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    lastPointRef.current = next;
    if (!hasInk) setHasInk(true);
  }

  function onPointerUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d') ?? null;
    if (canvas === null || ctx === null) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
    onClear?.();
  }

  function save() {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (!hasInk) return;
    const signatureData = canvas.toDataURL('image/png');
    const name = signerName.trim();
    if (name.length === 0) return;
    const role = signerRole.trim();
    onSave({
      signatureData,
      signerName: name,
      ...(role.length > 0 ? { signerRole: role } : {}),
    });
  }

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerCancel={onPointerUp}
        className="h-40 w-full touch-none rounded-md border bg-white"
        aria-label={t('sign')}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="signer-name">{t('signerNameLabel')}</Label>
          <Input
            id="signer-name"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder={t('signerNamePlaceholder')}
            autoComplete="name"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="signer-role">{t('signerRoleLabel')}</Label>
          <Input
            id="signer-role"
            value={signerRole}
            onChange={(e) => setSignerRole(e.target.value)}
            autoComplete="organization-title"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={clear} disabled={!hasInk || saving}>
          {t('clear')}
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={!hasInk || signerName.trim().length === 0 || saving}
        >
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
