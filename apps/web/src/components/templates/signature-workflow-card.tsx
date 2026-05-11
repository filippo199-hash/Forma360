'use client';

/**
 * Template-level Signature Workflow card.
 *
 * Two states:
 *   - Collapsed (workflow undefined or disabled): a single row with an
 *     icon + "Add signature" label + Switch on the right.
 *   - Expanded (workflow.enabled === true): full card with workflow-type
 *     selector, signatories list with add/reorder/remove, and "Notify on
 *     completion" toggle.
 *
 * Reads/writes through the editor reducer's `updateSettings` action so
 * the change participates in dirty-tracking + autosave.
 */

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SignatureWorkflow } from '@forma360/shared/template-schema';
import {
  ArrowRightCircle,
  Bell,
  CheckCircle2,
  GripVertical,
  Plus,
  Search,
  Signature,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { trpc } from '../../lib/trpc/client';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { useEditor } from './editor-context';

const DEFAULT_WORKFLOW: SignatureWorkflow = {
  enabled: true,
  mode: 'sequential',
  signatoryUserIds: [],
  notifyOnCompletion: false,
};

export function SignatureWorkflowCard() {
  const t = useTranslations('templates.editor.settingsTab.signatureWorkflow');
  const { state, dispatch } = useEditor();
  const workflow = state.content.settings.signatureWorkflow;
  const enabled = workflow?.enabled === true;

  function setWorkflow(next: SignatureWorkflow | undefined) {
    dispatch({ type: 'updateSettings', patch: { signatureWorkflow: next } });
  }

  if (!enabled) {
    // Collapsed view — single-row prompt with toggle.
    return (
      <Card className="md:col-span-2">
        <CardContent className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
              <Signature className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-medium">{t('addSignature')}</p>
            </div>
          </div>
          <Switch
            checked={false}
            onCheckedChange={(checked) => {
              if (checked) setWorkflow(DEFAULT_WORKFLOW);
            }}
            aria-label={t('addSignature')}
          />
        </CardContent>
      </Card>
    );
  }

  // Expanded view — we know workflow is defined here.
  const current = workflow ?? DEFAULT_WORKFLOW;
  return (
    <Card className="md:col-span-2">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{t('title')}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Switch
          checked={true}
          onCheckedChange={(checked) => {
            // Toggling off keeps the rest of the config so flipping back on
            // restores the previous mode + signatories.
            setWorkflow({ ...current, enabled: checked });
          }}
          aria-label={t('title')}
        />
      </CardHeader>
      <CardContent className="space-y-6">
        <WorkflowTypeSection workflow={current} onChange={setWorkflow} />
        <SignatoriesSection workflow={current} onChange={setWorkflow} />
        <AdditionalSettingsSection workflow={current} onChange={setWorkflow} />
      </CardContent>
    </Card>
  );
}

function WorkflowTypeSection({
  workflow,
  onChange,
}: {
  workflow: SignatureWorkflow;
  onChange: (next: SignatureWorkflow) => void;
}) {
  const t = useTranslations('templates.editor.settingsTab.signatureWorkflow');
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t('workflowType')}</h3>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange({ ...workflow, mode: 'sequential' })}
          className={
            workflow.mode === 'sequential'
              ? 'flex flex-col items-start gap-2 rounded-lg border-2 border-primary bg-accent/50 p-4 text-left transition-colors'
              : 'flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40'
          }
          aria-pressed={workflow.mode === 'sequential'}
        >
          <div className="flex items-center gap-2">
            <ArrowRightCircle className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">{t('sequential')}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('sequentialDescription')}</p>
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...workflow, mode: 'parallel' })}
          className={
            workflow.mode === 'parallel'
              ? 'flex flex-col items-start gap-2 rounded-lg border-2 border-primary bg-accent/50 p-4 text-left transition-colors'
              : 'flex flex-col items-start gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40'
          }
          aria-pressed={workflow.mode === 'parallel'}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-sm font-medium">{t('parallel')}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t('parallelDescription')}</p>
        </button>
      </div>
    </section>
  );
}

interface DirectoryUser {
  id: string;
  name: string;
  email: string;
}

function SignatoriesSection({
  workflow,
  onChange,
}: {
  workflow: SignatureWorkflow;
  onChange: (next: SignatureWorkflow) => void;
}) {
  const t = useTranslations('templates.editor.settingsTab.signatureWorkflow');
  const [pickerOpen, setPickerOpen] = useState(false);
  const usersQuery = trpc.users.list.useQuery({ limit: 200 });
  const allUsers: DirectoryUser[] = useMemo(() => {
    const data = usersQuery.data?.users;
    if (data === undefined) return [];
    return data.map((u) => ({ id: u.id, name: u.name, email: u.email }));
  }, [usersQuery.data]);

  const usersById = useMemo(() => {
    const map = new Map<string, DirectoryUser>();
    for (const u of allUsers) map.set(u.id, u);
    return map;
  }, [allUsers]);

  function removeAt(idx: number) {
    const next = workflow.signatoryUserIds.filter((_, i) => i !== idx);
    onChange({ ...workflow, signatoryUserIds: next });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = workflow.signatoryUserIds.indexOf(String(active.id));
    const to = workflow.signatoryUserIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onChange({
      ...workflow,
      signatoryUserIds: arrayMove(workflow.signatoryUserIds, from, to),
    });
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('signatories')}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPickerOpen(true)}
          disabled={workflow.signatoryUserIds.length >= 10}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
          {t('addSignatory')}
        </Button>
      </div>

      {workflow.signatoryUserIds.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 py-8 text-center">
          <Signature className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">{t('noSignatoriesTitle')}</p>
          <p className="text-xs text-muted-foreground">{t('noSignatoriesBody')}</p>
          <Button type="button" size="sm" onClick={() => setPickerOpen(true)}>
            {t('addFirstSignatory')}
          </Button>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={workflow.signatoryUserIds}
            strategy={verticalListSortingStrategy}
          >
            <ul className="space-y-2">
              {workflow.signatoryUserIds.map((userId, idx) => {
                const u = usersById.get(userId);
                return (
                  <SortableSignerRow
                    key={userId}
                    userId={userId}
                    user={u}
                    position={idx + 1}
                    showPosition={workflow.mode === 'sequential'}
                    onRemove={() => removeAt(idx)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <SignatoryPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allUsers={allUsers}
        excludeIds={workflow.signatoryUserIds}
        onSelect={(userId) => {
          if (workflow.signatoryUserIds.includes(userId)) return;
          if (workflow.signatoryUserIds.length >= 10) return;
          onChange({
            ...workflow,
            signatoryUserIds: [...workflow.signatoryUserIds, userId],
          });
          setPickerOpen(false);
        }}
      />
    </section>
  );
}

function SortableSignerRow({
  userId,
  user,
  position,
  showPosition,
  onRemove,
}: {
  userId: string;
  user: DirectoryUser | undefined;
  position: number;
  showPosition: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: userId,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const initials = (user?.name ?? userId).slice(0, 2).toUpperCase();
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      {showPosition ? (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {position}
        </span>
      ) : null}
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
        {initials}
      </div>
      <div className="flex-1 truncate">
        <p className="truncate text-sm font-medium">{user?.name ?? userId}</p>
        {user?.email !== undefined && user.email.length > 0 ? (
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Remove signatory"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

function SignatoryPickerDialog({
  open,
  onOpenChange,
  allUsers,
  excludeIds,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allUsers: readonly DirectoryUser[];
  excludeIds: readonly string[];
  onSelect: (userId: string) => void;
}) {
  const t = useTranslations('templates.editor.settingsTab.signatureWorkflow');
  const [search, setSearch] = useState('');
  const excludeSet = useMemo(() => new Set(excludeIds), [excludeIds]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers
      .filter((u) => !excludeSet.has(u.id))
      .filter((u) => {
        if (q.length === 0) return true;
        return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
      })
      .slice(0, 200);
  }, [allUsers, excludeSet, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('addSignatory')}</DialogTitle>
          <DialogDescription>{t('noSignatoriesBody')}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search
            className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('addSignatory')}
            className="pl-8"
            autoFocus
          />
        </div>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {filtered.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => onSelect(u.id)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                  {u.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 truncate">
                  <p className="truncate text-sm font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
              </button>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li className="px-2 py-4 text-center text-xs text-muted-foreground">
              {t('noSignatoriesTitle')}
            </li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function AdditionalSettingsSection({
  workflow,
  onChange,
}: {
  workflow: SignatureWorkflow;
  onChange: (next: SignatureWorkflow) => void;
}) {
  const t = useTranslations('templates.editor.settingsTab.signatureWorkflow');
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{t('additionalSettings')}</h3>
      <label className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer rounded border-input"
            checked={workflow.notifyOnCompletion}
            onChange={(e) => onChange({ ...workflow, notifyOnCompletion: e.target.checked })}
          />
        </div>
        <div className="flex flex-1 items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm">{t('notifyOnCompletion')}</span>
        </div>
      </label>
    </section>
  );
}
