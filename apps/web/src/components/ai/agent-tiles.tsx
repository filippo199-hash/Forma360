'use client';

/**
 * The agent tile grid (AI Agents feature) — the discovery surface for
 * task agents, shown on the AI page's landing state and on /ai/agents.
 *
 * A tile navigates to the agent's SETTINGS page (the product decision:
 * tiles are where you set an agent up; the WORK happens inside the
 * agent's module, where its Draft-with-AI panel lives). Tiles show only
 * agents the viewer could actually use — brand-gated by module and
 * permission-gated exactly like the nav — so a FreeHS-only agent never
 * teases a Forma360 user. Admins see every (brand-visible) agent,
 * including switched-off ones, marked "Off" so they can switch them on.
 *
 * Labels bind through variable keys (`agents.${id}.name`), which K01
 * cannot see — `ai-agents-i18n.test.ts` pins the full key set across all
 * ten locales instead (the nav-key-parity pattern).
 */
import {
  BarChart3,
  ClipboardList,
  FileSearch,
  FileText,
  Flame,
  FlaskConical,
  ListChecks,
  Megaphone,
  SearchCheck,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { brandHasModule } from '@forma360/shared/brand';
import { grantsAdminAccess } from '@forma360/permissions/catalogue';
import type { AiAgentId } from '@forma360/shared/ai-agents';
import { activeBrand } from '../../lib/brand';
import { useEntitlementList, usePermissionList } from '../../lib/permissions-context';
import { trpc } from '../../lib/trpc/client';

const AGENT_ICON: Record<AiAgentId, LucideIcon> = {
  'template-drafter': ClipboardList,
  'dashboard-builder': BarChart3,
  'sds-importer': FileSearch,
  'ra-drafter': ShieldAlert,
  'coshh-drafter': FlaskConical,
  'rams-drafter': ListChecks,
  'fra-assistant': Flame,
  'investigation-assistant': SearchCheck,
  'briefing-writer': Megaphone,
  'permit-preparer': FileText,
};

export function AgentTiles() {
  const t = useTranslations('aiAgents');
  const params = useParams<{ locale: string }>();
  const locale = params.locale ?? 'en';
  const permissions = usePermissionList();
  const entitlements = useEntitlementList();
  const isAdmin = grantsAdminAccess(permissions);

  const { data } = trpc.aiAgents.list.useQuery();
  if (data === undefined) return null;

  const visible = data.filter((agent) => {
    if (agent.module !== null && !brandHasModule(activeBrand.id, agent.module)) return false;
    if (isAdmin) return true;
    if (!agent.enabled) return false;
    return permissions.includes(agent.usePermission);
  });
  if (visible.length === 0) return null;

  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {visible.map((agent) => {
        const Icon = AGENT_ICON[agent.id];
        return (
          <Link
            key={agent.id}
            href={`/${locale}/ai/agents/${agent.id}`}
            className="group flex items-start gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/40"
          >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {t(`agents.${agent.id}.name` as never)}
                </span>
                {agent.entitlement !== null && !entitlements.includes(agent.entitlement) ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    {t('hub.upgrade')}
                  </span>
                ) : null}
                {!agent.enabled ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {t('hub.off')}
                  </span>
                ) : agent.hasKnowledge ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    {t('hub.taught')}
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(`agents.${agent.id}.tile` as never)}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
