/**
 * Maintenance → Actions bridge (To-Do #3).
 *
 * Attaching a maintenance program to an asset materialises one future-dated
 * Action per trigger; completing that Action rolls the next one forward.
 * Maintenance actions use `sourceType = 'maintenance'`, `sourceId = triggerId`,
 * and link the asset through `action_assets`. `sourceItemId` stays NULL so
 * the `(sourceType, sourceId, sourceItemId)` unique index never blocks a
 * fresh occurrence (Postgres treats NULLs as distinct).
 */
import {
  actionAssets,
  actions,
  assetReadings,
  maintenanceProgramTriggers,
  type MaintenanceProgramTrigger,
} from '@forma360/db/schema';
import { newId } from '@forma360/shared/id';
import { and, count, desc, eq } from 'drizzle-orm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const MS_PER_DAY = 86_400_000;

/**
 * In-code default program templates surfaced in the "start from template"
 * picker. Cloning one creates a real program + triggers the user can edit.
 */
export interface MaintenanceTemplateTrigger {
  title: string;
  triggerType: 'time' | 'distance' | 'usage';
  intervalDays?: number;
  intervalValue?: number;
  usageField?: string;
  unit?: string;
}
export interface MaintenanceTemplate {
  key: string;
  name: string;
  description: string;
  triggers: MaintenanceTemplateTrigger[];
}

export const DEFAULT_MAINTENANCE_TEMPLATES: MaintenanceTemplate[] = [
  {
    key: 'van',
    name: 'Van / Light Vehicle',
    description: 'Standard servicing schedule for a light commercial vehicle.',
    triggers: [
      {
        title: 'Change oil & filter',
        triggerType: 'distance',
        intervalValue: 10000,
        usageField: 'odometer',
        unit: 'km',
      },
      { title: 'Rotate / inspect tyres', triggerType: 'time', intervalDays: 365 },
      {
        title: 'Full service',
        triggerType: 'distance',
        intervalValue: 20000,
        usageField: 'odometer',
        unit: 'km',
      },
      { title: 'Replace cabin air filter', triggerType: 'time', intervalDays: 365 },
    ],
  },
  {
    key: 'forklift',
    name: 'Forklift',
    description: 'Hour-meter based maintenance for a warehouse forklift.',
    triggers: [
      {
        title: 'Engine oil change',
        triggerType: 'usage',
        intervalValue: 250,
        usageField: 'hours',
        unit: 'hours',
      },
      {
        title: 'Hydraulic inspection',
        triggerType: 'usage',
        intervalValue: 500,
        usageField: 'hours',
        unit: 'hours',
      },
      { title: 'Annual safety inspection', triggerType: 'time', intervalDays: 365 },
    ],
  },
  {
    key: 'hvac',
    name: 'HVAC Unit',
    description: 'Routine servicing for a building HVAC unit.',
    triggers: [
      { title: 'Replace filters', triggerType: 'time', intervalDays: 90 },
      { title: 'Coil clean & inspection', triggerType: 'time', intervalDays: 180 },
      { title: 'Full service', triggerType: 'time', intervalDays: 365 },
    ],
  },
];

async function nextRef(db: Db, tenantId: string): Promise<string> {
  const rows = await db.select({ c: count() }).from(actions).where(eq(actions.tenantId, tenantId));
  const next = Number(rows[0]?.c ?? 0) + 1;
  return `AC-${next.toString().padStart(6, '0')}`;
}

async function latestReading(
  db: Db,
  tenantId: string,
  assetId: string,
  fieldName: string | null,
): Promise<number | null> {
  if (fieldName === null) return null;
  const rows = await db
    .select({ value: assetReadings.value })
    .from(assetReadings)
    .where(
      and(
        eq(assetReadings.tenantId, tenantId),
        eq(assetReadings.assetId, assetId),
        eq(assetReadings.fieldName, fieldName),
      ),
    )
    .orderBy(desc(assetReadings.capturedAt))
    .limit(1);
  const v = rows[0]?.value;
  return v != null ? Number(v) : null;
}

/**
 * Create one maintenance Action for a trigger + asset. Time triggers get a
 * concrete due date; distance/usage triggers carry the target value in the
 * description and leave `dueAt` null (they're "due when the meter reaches X").
 */
export async function generateMaintenanceAction(
  db: Db,
  args: {
    tenantId: string;
    userId: string;
    trigger: MaintenanceProgramTrigger;
    assetId: string;
    assetName: string;
    /** Base date for time triggers (defaults to now). */
    baseDate?: Date;
  },
): Promise<string> {
  const now = new Date();
  const { tenantId, userId, trigger, assetId, assetName } = args;
  const id = newId();
  const referenceNumber = await nextRef(db, tenantId);

  let dueAt: Date | null = null;
  let description: string;
  if (trigger.triggerType === 'time') {
    const base = args.baseDate ?? now;
    const days = trigger.intervalDays ?? 0;
    dueAt = new Date(base.getTime() + days * MS_PER_DAY);
    description = `Recurs every ${days} day${days === 1 ? '' : 's'}.`;
  } else {
    const unit = trigger.unit ?? '';
    const interval = trigger.intervalValue != null ? Number(trigger.intervalValue) : 0;
    const current = await latestReading(db, tenantId, assetId, trigger.usageField);
    const target = (current ?? 0) + interval;
    description =
      `Due at ${target} ${unit} (every ${interval} ${unit}).` +
      (current !== null ? ` Current reading: ${current} ${unit}.` : '');
  }

  await db.insert(actions).values({
    id,
    tenantId,
    sourceType: 'maintenance',
    sourceId: trigger.id,
    sourceItemId: null,
    referenceNumber,
    title: `${trigger.title} — ${assetName}`,
    description,
    status: 'open',
    priority: null,
    assigneeUserId: null,
    dueAt,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(actionAssets)
    .values({ id: newId(), tenantId, actionId: id, assetId })
    .onConflictDoNothing();
  return id;
}

/**
 * Whether an OPEN (non-terminal) maintenance action already exists for a
 * given trigger + asset, so attach doesn't create duplicates.
 */
export async function hasOpenMaintenanceAction(
  db: Db,
  tenantId: string,
  triggerId: string,
  assetId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: actions.id })
    .from(actions)
    .innerJoin(actionAssets, eq(actionAssets.actionId, actions.id))
    .where(
      and(
        eq(actions.tenantId, tenantId),
        eq(actions.sourceType, 'maintenance'),
        eq(actions.sourceId, triggerId),
        eq(actionAssets.assetId, assetId),
      ),
    )
    .limit(50);
  // Treat only non-terminal rows as "open".
  if (rows.length === 0) return false;
  const open = await db
    .select({ id: actions.id, status: actions.status })
    .from(actions)
    .innerJoin(actionAssets, eq(actionAssets.actionId, actions.id))
    .where(
      and(
        eq(actions.tenantId, tenantId),
        eq(actions.sourceType, 'maintenance'),
        eq(actions.sourceId, triggerId),
        eq(actionAssets.assetId, assetId),
      ),
    );
  return open.some((r: { status: string }) => r.status === 'open' || r.status === 'in_progress');
}

/**
 * Called from `actions.setStatus` when a maintenance action is completed:
 * materialise the next occurrence so the program keeps rolling forward.
 */
export async function rollForwardMaintenanceAction(
  db: Db,
  args: {
    tenantId: string;
    userId: string;
    action: { id: string; sourceType: string; sourceId: string | null; dueAt: Date | null };
  },
): Promise<void> {
  const { tenantId, userId, action } = args;
  if (action.sourceType !== 'maintenance' || action.sourceId === null) return;

  const triggerRows = await db
    .select()
    .from(maintenanceProgramTriggers)
    .where(
      and(
        eq(maintenanceProgramTriggers.tenantId, tenantId),
        eq(maintenanceProgramTriggers.id, action.sourceId),
      ),
    )
    .limit(1);
  const trigger = triggerRows[0] as MaintenanceProgramTrigger | undefined;
  if (trigger === undefined) return; // trigger removed — chain ends

  // Asset linked to the completed action.
  const assetRows = await db
    .select({ assetId: actionAssets.assetId })
    .from(actionAssets)
    .where(eq(actionAssets.actionId, action.id))
    .limit(1);
  const assetId = assetRows[0]?.assetId as string | undefined;
  if (assetId === undefined) return;

  // Resolve a display name for the asset (best effort).
  const { assets } = await import('@forma360/db/schema');
  const aRows = await db
    .select({ name: assets.name })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  const assetName = (aRows[0]?.name as string | undefined) ?? 'Asset';

  await generateMaintenanceAction(db, {
    tenantId,
    userId,
    trigger,
    assetId,
    assetName,
    // Time triggers roll from completion (just serviced → next in N days).
    baseDate: new Date(),
  });
}
