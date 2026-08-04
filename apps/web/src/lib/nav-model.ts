/**
 * The navigation information architecture — one pure, testable model that
 * both the desktop sidebar, the mobile drawer and the mobile tab bar
 * render. See ADR 0014.
 *
 * Why a model rather than JSX: the interesting behaviour of a menu is not
 * how it looks, it is what it *contains* — which entries a given viewer
 * can see, which group they fall in, which one lights up for the current
 * URL, and which surfaces stay reachable when a group is collapsed. All
 * of that is decidable from data, so it lives here with unit tests next
 * to it (NAV-E01..NAV-E10) instead of being asserted by eye in a browser.
 *
 * Three gates, applied in this order:
 *   1. brand    — ADR 0010. A module the active brand does not ship never
 *                 enters the model at all.
 *   2. permission — PF-27. An entry whose view permission the caller does
 *                 not hold is dropped. Administrators (`org.settings`)
 *                 bypass this.
 *   3. emptiness — a group whose items were all dropped disappears with
 *                 them, heading included. No brand or role ever sees a
 *                 heading with nothing under it.
 */
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Bot,
  Building2,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  FileSignature,
  FileStack,
  Flame,
  FlaskConical,
  FolderOpen,
  Hammer,
  HardHat,
  Inbox,
  ListChecks,
  QrCode,
  ScrollText,
  Settings,
  ShieldAlert,
  Siren,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { brandHasModule, type BrandId, type BrandOnlyModule } from '@forma360/shared/brand';
import { grantsAdminAccess, type PermissionKey } from '@forma360/permissions/catalogue';

/** Every top-level destination. The i18n key is `nav.<key>`. */
export type NavItemKey =
  | 'analytics'
  | 'myWork'
  | 'ai'
  | 'riskAssessments'
  | 'coshh'
  | 'permits'
  | 'rams'
  | 'fireSafety'
  | 'inspections'
  | 'schedules'
  | 'approvals'
  | 'templates'
  | 'issues'
  | 'incidents'
  | 'actions'
  | 'headsUp'
  | 'sites'
  | 'assets'
  | 'maintenance'
  | 'documents'
  | 'contractors'
  | 'settings';

/** Second-level destinations. The i18n key is `nav.child.<key>`. */
export type NavChildKey =
  | 'schedulesCalendar'
  | 'permitsBoard'
  | 'permitsTypes'
  | 'coshhPointOfWork'
  | 'coshhLev'
  | 'ramsLibrary'
  | 'ramsReviews'
  | 'fireLogbook'
  | 'issuesQrCodes'
  | 'issuesCategories'
  | 'actionsCategories'
  | 'assetsCategories'
  | 'contractorsGate'
  | 'contractorsCalendar';

/**
 * Group headings. `null` is the unlabelled block at the very top — the
 * three orientation entries that answer "where am I and what is mine",
 * which practitioners reach for before any module.
 */
export type NavSectionKey = 'groupRisk' | 'groupVerify' | 'groupRespond' | 'groupOrg';

/**
 * Counts the menu is allowed to show. Deliberately short: every badge is
 * either the caller's own queue or a queue the caller owns, so a number
 * on the menu always means "you, now". Org-wide totals belong on the
 * dashboard, not in the chrome.
 */
export type NavBadgeKey = 'myWork' | 'approvals' | 'actions' | 'headsUp';

export interface NavChild {
  readonly key: NavChildKey;
  readonly href: string;
  /** Defaults to the parent's permission when omitted. */
  readonly permission?: PermissionKey;
}

export interface NavItem {
  readonly key: NavItemKey;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly permission?: PermissionKey;
  readonly badge?: NavBadgeKey;
  /** Revealed inline while the parent is the active route. */
  readonly children?: readonly NavChild[];
}

export interface NavSection {
  readonly key: NavSectionKey | null;
  readonly items: readonly NavItem[];
}

/** Brand-only modules keyed by the nav entry that carries them. */
const BRAND_MODULE_FOR: Partial<Record<NavItemKey, BrandOnlyModule>> = {
  riskAssessments: 'riskAssessments',
  coshh: 'coshh',
  permits: 'permits',
  rams: 'rams',
  fireSafety: 'fireSafety',
  incidents: 'incidents',
};

/**
 * The IA, in render order. Structured on the shape of the work rather
 * than on the shape of the database: what you plan and control, what you
 * verify, what you do about what you found, and the organisational
 * records all of it hangs off.
 */
function sectionBlueprint(locale: string): readonly NavSection[] {
  const p = (path: string): string => `/${locale}${path}`;
  return [
    {
      key: null,
      items: [
        { key: 'analytics', href: p('/analytics'), icon: ChartColumn, permission: 'analytics.view' },
        { key: 'myWork', href: p('/my-work'), icon: Inbox, badge: 'myWork' },
        { key: 'ai', href: p('/ai'), icon: Bot },
      ],
    },
    {
      key: 'groupRisk',
      items: [
        {
          key: 'riskAssessments',
          href: p('/risk-assessments'),
          icon: ShieldAlert,
          permission: 'riskAssessments.view',
        },
        {
          key: 'coshh',
          href: p('/coshh'),
          icon: FlaskConical,
          permission: 'coshh.view',
          children: [
            { key: 'coshhPointOfWork', href: p('/coshh/point-of-work') },
            { key: 'coshhLev', href: p('/coshh/lev') },
          ],
        },
        {
          key: 'permits',
          href: p('/permits'),
          icon: FileSignature,
          permission: 'permits.view',
          children: [
            { key: 'permitsBoard', href: p('/permits/board') },
            { key: 'permitsTypes', href: p('/permits/types'), permission: 'permits.manage' },
          ],
        },
        // Sits after Permits — both are "plan the job, then do it safely"
        // surfaces, and a permit type can demand an issued RAMS pack
        // (ADR 0015 module, ADR 0010 brand gate).
        {
          key: 'rams',
          href: p('/rams'),
          icon: ScrollText,
          permission: 'rams.view',
          children: [
            { key: 'ramsLibrary', href: p('/rams/library'), permission: 'rams.manage' },
            { key: 'ramsReviews', href: p('/rams/reviews'), permission: 'rams.review' },
          ],
        },
        {
          key: 'fireSafety',
          href: p('/fire-safety'),
          icon: Flame,
          permission: 'fireSafety.view',
          children: [{ key: 'fireLogbook', href: p('/fire-safety/logbook') }],
        },
      ],
    },
    {
      key: 'groupVerify',
      items: [
        {
          key: 'inspections',
          href: p('/inspections'),
          icon: ClipboardCheck,
          permission: 'inspections.view',
        },
        {
          key: 'schedules',
          href: p('/schedules'),
          icon: CalendarClock,
          permission: 'inspections.view',
          children: [{ key: 'schedulesCalendar', href: p('/schedules/calendar') }],
        },
        {
          key: 'approvals',
          href: p('/approvals'),
          icon: BadgeCheck,
          permission: 'inspections.manage',
          badge: 'approvals',
        },
        {
          key: 'templates',
          href: p('/templates'),
          icon: FileStack,
          permission: 'templates.view',
        },
      ],
    },
    {
      key: 'groupRespond',
      items: [
        {
          key: 'issues',
          href: p('/observations'),
          icon: AlertTriangle,
          permission: 'issues.view',
          children: [
            { key: 'issuesQrCodes', href: p('/observations/qr-codes') },
            { key: 'issuesCategories', href: p('/observations/categories') },
          ],
        },
        // Sits between Observations and Actions — the found → recorded →
        // fixed reading order (ADR 0013 module, ADR 0010 brand gate).
        {
          key: 'incidents',
          href: p('/incidents'),
          icon: Siren,
          permission: 'incidents.view',
        },
        {
          key: 'actions',
          href: p('/actions'),
          icon: ListChecks,
          permission: 'actions.view',
          badge: 'actions',
          children: [
            { key: 'actionsCategories', href: p('/actions/categories'), permission: 'actions.settings' },
          ],
        },
        {
          key: 'headsUp',
          href: p('/heads-up'),
          icon: Bell,
          permission: 'headsUp.view',
          badge: 'headsUp',
        },
      ],
    },
    {
      key: 'groupOrg',
      items: [
        { key: 'sites', href: p('/sites'), icon: Building2, permission: 'sites.view' },
        {
          key: 'assets',
          href: p('/assets'),
          icon: Wrench,
          permission: 'assets.view',
          children: [
            { key: 'assetsCategories', href: p('/assets/categories'), permission: 'assets.manage' },
          ],
        },
        {
          key: 'maintenance',
          href: p('/maintenance'),
          icon: Hammer,
          permission: 'assets.maintenance.manage',
        },
        { key: 'documents', href: p('/documents'), icon: FolderOpen, permission: 'documents.view' },
        {
          key: 'contractors',
          href: p('/contractors'),
          icon: HardHat,
          permission: 'contractors.view',
          children: [
            { key: 'contractorsGate', href: p('/contractors/gate'), permission: 'contractors.gate' },
            { key: 'contractorsCalendar', href: p('/contractors/calendar') },
          ],
        },
      ],
    },
  ];
}

export interface NavModelInput {
  readonly locale: string;
  readonly brandId: BrandId;
  readonly permissions: readonly string[];
}

/** The Settings entry, pinned to the foot of the menu in every renderer. */
export function settingsNavItem(locale: string): NavItem {
  return { key: 'settings', href: `/${locale}/settings`, icon: Settings };
}

/**
 * Build the viewer's menu: brand-gated, then permission-gated, then
 * emptied of any group that lost all of its items.
 */
export function buildNavSections(input: NavModelInput): readonly NavSection[] {
  const isAdmin = grantsAdminAccess(input.permissions);
  const holds = (perm: PermissionKey | undefined): boolean =>
    perm === undefined || isAdmin || input.permissions.includes(perm);

  const sections: NavSection[] = [];
  for (const section of sectionBlueprint(input.locale)) {
    const items: NavItem[] = [];
    for (const item of section.items) {
      const brandModule = BRAND_MODULE_FOR[item.key];
      if (brandModule !== undefined && !brandHasModule(input.brandId, brandModule)) continue;
      if (!holds(item.permission)) continue;
      const children = item.children?.filter((child) => holds(child.permission ?? item.permission));
      items.push(
        children !== undefined && children.length > 0 ? { ...item, children } : stripChildren(item),
      );
    }
    if (items.length > 0) sections.push({ key: section.key, items });
  }
  return sections;
}

/** Drop the `children` key entirely — `exactOptionalPropertyTypes` forbids `undefined`. */
function stripChildren(item: NavItem): NavItem {
  const { children: _children, ...rest } = item;
  return rest;
}

/** Every top-level item across every group, in render order. */
export function flattenNavItems(sections: readonly NavSection[]): readonly NavItem[] {
  return sections.flatMap((section) => section.items);
}

/**
 * Is `item` the entry the current URL belongs to?
 *
 * Exact match or a path-segment prefix. Deliberately no cross-entry
 * aliasing: before ADR 0014 the Inspections entry also lit up for
 * `/approvals` and `/schedules`, which — now that those are entries in
 * their own right — highlighted two rows at once and made the menu lie
 * about where you were.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return matchesHref(item.href, pathname);
}

export function isNavChildActive(child: NavChild, pathname: string): boolean {
  return matchesHref(child.href, pathname);
}

function matchesHref(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The item whose sub-navigation should be showing, if any. Children are
 * revealed only while their parent owns the route, so the resting menu
 * stays the length of the module list.
 */
export function activeNavItem(
  sections: readonly NavSection[],
  pathname: string,
): NavItem | undefined {
  return flattenNavItems(sections).find((item) => isNavItemActive(item, pathname));
}

/**
 * The mobile tab bar: five thumb-reachable destinations, chosen from what
 * the viewer can actually open. Order is fixed — a tab bar that reorders
 * itself between sessions defeats the muscle memory that makes it worth
 * having — and the last slot is always "more", which opens the full menu.
 *
 * `Report` (raise an observation) outranks browsing: on a phone, in the
 * field, the overwhelmingly common intent is to record something.
 */
export const MOBILE_TAB_PRIORITY: readonly NavItemKey[] = [
  'myWork',
  'issues',
  'incidents',
  'inspections',
  'actions',
  'permits',
  'fireSafety',
  'coshh',
  'rams',
  'analytics',
  'ai',
];

/** How many nav entries the tab bar shows before the "more" tab. */
export const MOBILE_TAB_SLOTS = 4;

export function buildMobileTabs(sections: readonly NavSection[]): readonly NavItem[] {
  const byKey = new Map(flattenNavItems(sections).map((item) => [item.key, item]));
  const tabs: NavItem[] = [];
  for (const key of MOBILE_TAB_PRIORITY) {
    if (tabs.length === MOBILE_TAB_SLOTS) break;
    const item = byKey.get(key);
    if (item !== undefined) tabs.push(item);
  }
  return tabs;
}

/** Icon for the "no badge value yet" case and for sub-nav bullets. */
export const NAV_CHILD_ICON: Record<NavChildKey, LucideIcon> = {
  schedulesCalendar: CalendarDays,
  permitsBoard: ClipboardCheck,
  permitsTypes: FileStack,
  coshhPointOfWork: FlaskConical,
  coshhLev: Wrench,
  ramsLibrary: FileStack,
  ramsReviews: HardHat,
  fireLogbook: Flame,
  issuesQrCodes: QrCode,
  issuesCategories: FolderOpen,
  actionsCategories: FolderOpen,
  assetsCategories: FolderOpen,
  contractorsGate: HardHat,
  contractorsCalendar: CalendarDays,
};
