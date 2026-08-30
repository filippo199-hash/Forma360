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
 *                 them, separator included. No brand or role ever sees a
 *                 rule with nothing under it.
 */
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  CircleUserRound,
  ClipboardCheck,
  FileSignature,
  FileStack,
  Flame,
  FlaskConical,
  FolderOpen,
  GraduationCap,
  HardHat,
  LayoutDashboard,
  ListChecks,
  ListTodo,
  Microscope,
  QrCode,
  ScrollText,
  Settings,
  ShieldAlert,
  Siren,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { brandHasModule, type BrandId, type BrandOnlyModule } from '@forma360/shared/brand';
import type { EntitlementKey } from '@forma360/shared/entitlements';
import { grantsAdminAccess, type PermissionKey } from '@forma360/permissions/catalogue';

/** Every top-level destination. The i18n key is `nav.<key>`. */
export type NavItemKey =
  | 'analytics'
  | 'dashboards'
  | 'forMe'
  | 'inspections'
  | 'issues'
  | 'incidents'
  | 'permits'
  | 'actions'
  | 'riskAssessments'
  | 'coshh'
  | 'fireSafety'
  | 'rams'
  | 'training'
  | 'sites'
  | 'assets'
  | 'contractors'
  | 'documents'
  | 'headsUp'
  | 'settings';

/** Second-level destinations. The i18n key is `nav.child.<key>`. */
export type NavChildKey =
  | 'templates'
  | 'schedules'
  | 'schedulesCalendar'
  | 'approvals'
  | 'permitsBoard'
  | 'permitsTypes'
  | 'coshhPointOfWork'
  | 'coshhLev'
  | 'ramsLibrary'
  | 'ramsReviews'
  | 'trainingMe'
  | 'trainingMatrix'
  | 'trainingCompliance'
  | 'trainingRequirements'
  | 'fireLogbook'
  | 'fireSafetySettings'
  | 'incidentInvestigations'
  | 'issuesQrCodes'
  | 'issuesCategories'
  | 'actionsCategories'
  | 'contractorsGate'
  | 'contractorsCalendar';

/**
 * Group identity. `null` is the block at the very top — the three
 * orientation entries that answer "where am I and what is mine", which
 * practitioners reach for before any module.
 *
 * These keys no longer name a *visible* heading: the renderers draw a
 * hairline rule between groups instead of a labelled, foldable section.
 * They stay because the grouping itself is still real — it fixes render
 * order and is what the model's tests assert against — and because the
 * blueprint below reads as prose about the shape of the work.
 */
export type NavSectionKey = 'groupDoWork' | 'groupRecords' | 'groupOrg';

export interface NavChild {
  readonly key: NavChildKey;
  readonly href: string;
  /** Defaults to the parent's permission when omitted. */
  readonly permission?: PermissionKey;
}

/**
 * Deliberately NO count badges anywhere in this model (they existed —
 * eight rows of them — and were removed on user feedback): a menu that
 * numbers every queue reads as one undifferentiated wall of overdue
 * work, with no way to tell the urgent from the routine, and people
 * reported it as anxiety rather than signal. Each register triages its
 * own queue on its own page, where the numbers come with the means to
 * act on them. NAV-E09 pins this; do not re-add a `badge` field without
 * that conversation.
 */
export interface NavItem {
  readonly key: NavItemKey;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly permission?: PermissionKey;
  /** Paid-plan gate (ADR 0018): entry drops unless the tenant holds this. */
  readonly entitlement?: EntitlementKey;
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
  training: 'training',
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
    // Above the rule: the entries that answer *about* everything rather
    // than being a place you work (Lindqvist), plus the caller's own
    // queue. "For me" is one destination rather than a group of personal
    // doors — for the ~90% who are not safety professionals it *is* the
    // application (Bello), and the combined queue at /my-work already
    // merges actions, acknowledgements, signatures and drafts into one
    // list. Ungated: it can only ever show rows addressed to the caller.
    {
      key: null,
      items: [
        // "For me" is the landing surface — first in the menu (the fixed
        // /analytics "Overview" was removed; custom dashboards carry the
        // analytics surface now).
        { key: 'forMe', href: p('/my-work'), icon: ListTodo },
        // The assistant moved out of the rail: it is the "Ask AI" control
        // in the header now (this redesign's Cloudflare arrangement).
        // ADR 0018: AI-built custom dashboards — paid plans only.
        {
          key: 'dashboards',
          href: p('/dashboards'),
          icon: LayoutDashboard,
          permission: 'analytics.view',
          entitlement: 'customDashboards',
        },
      ],
    },
    // DO THE WORK — the golden thread in reading order: what you planned
    // and verified, what was found, what was harmed, what was controlled,
    // what is being fixed (Lindqvist).
    {
      key: 'groupDoWork',
      items: [
        {
          key: 'inspections',
          href: p('/inspections'),
          icon: ClipboardCheck,
          permission: 'inspections.view',
          // Templates, Schedules and Approvals have no independent
          // existence — nesting them is what takes the list from 20 to 16
          // without hiding anything.
          children: [
            { key: 'templates', href: p('/templates'), permission: 'templates.view' },
            { key: 'schedules', href: p('/schedules') },
            { key: 'schedulesCalendar', href: p('/schedules/calendar') },
            {
              key: 'approvals',
              href: p('/approvals'),
              permission: 'inspections.manage',
            },
          ],
        },
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
        {
          key: 'incidents',
          href: p('/incidents'),
          icon: Siren,
          permission: 'incidents.view',
          children: [{ key: 'incidentInvestigations', href: p('/incidents/investigations') }],
        },
        // A permit is a live operational control issued and closed within
        // a shift — work, not a register (the panel's contested call).
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
        // The same module as "My actions", two doors: managing every
        // action and closing your own three are different jobs.
        {
          key: 'actions',
          href: p('/actions'),
          icon: ListChecks,
          permission: 'actions.view',
          children: [
            {
              key: 'actionsCategories',
              href: p('/actions/categories'),
              permission: 'actions.settings',
            },
          ],
        },
      ],
    },
    // RECORDS & REGISTERS — documents that live for years and get
    // reviewed. One seam to point an auditor at (Nair, Lindqvist).
    {
      key: 'groupRecords',
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
        // Contains a live logbook, but its centre of gravity is the FRA
        // and the statutory calendar — hence a register.
        {
          key: 'fireSafety',
          href: p('/fire-safety'),
          icon: Flame,
          permission: 'fireSafety.view',
          children: [
            { key: 'fireLogbook', href: p('/fire-safety/logbook') },
            // BUG-14/FS-X01: designating which training requirement counts
            // as a fire-marshal ticket. Reachable from the nav rather than a
            // header button, matching where the logbook went.
            {
              key: 'fireSafetySettings',
              href: p('/fire-safety/settings'),
              permission: 'fireSafety.manage',
            },
          ],
        },
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
      ],
    },
    // THE ORGANISATION — the things work happens *to* and *with*, plus
    // the distribution channel alongside Documents.
    {
      key: 'groupOrg',
      items: [
        { key: 'sites', href: p('/sites'), icon: Building2, permission: 'sites.view' },
        // Categories is deliberately NOT a nav child: the register header's
        // gear icon reaches the same settings page, and a whole tab for a
        // rarely-touched admin list crowded the strip (review round 4).
        { key: 'assets', href: p('/assets'), icon: Wrench, permission: 'assets.view' },
        {
          key: 'contractors',
          href: p('/contractors'),
          icon: HardHat,
          permission: 'contractors.view',
          children: [
            {
              key: 'contractorsGate',
              href: p('/contractors/gate'),
              // CT-P03: this page CONFIGURES the kiosk (token + capture
              // fields), and both its queries need `contractors.manage`.
              // Gating the link on `contractors.gate` showed reception a
              // door that then refused to open. `contractors.gate` is the
              // *operating* key (check-in / check-out) and gates no nav
              // entry, the same shape as `fireSafety.record`.
              permission: 'contractors.manage',
            },
            { key: 'contractorsCalendar', href: p('/contractors/calendar') },
          ],
        },
        // TR-A15: the competence register sits beside Contractors, not with
        // the document registers. The panel's argument is that a reviewer
        // looking at "who is allowed to do this work" wants the two
        // competence registers — our people and their people — side by
        // side; training is about PEOPLE, which is what this group holds.
        {
          key: 'training',
          href: p('/training'),
          icon: GraduationCap,
          permission: 'training.view',
          // The module's full tab set (TR-B11): the landing is the gap
          // list, "My training" needs no permission beyond seeing the
          // module, requirements stays manage-gated. Order is tab order.
          children: [
            { key: 'trainingMe', href: p('/training/me') },
            { key: 'trainingMatrix', href: p('/training/matrix') },
            { key: 'trainingCompliance', href: p('/training/compliance') },
            {
              key: 'trainingRequirements',
              href: p('/training/requirements'),
              permission: 'training.manage',
            },
          ],
        },
        { key: 'documents', href: p('/documents'), icon: FolderOpen, permission: 'documents.view' },
        // "Briefings" to everyone outside this product — the rename the
        // panel asked for; the route lives at /briefings.
        {
          key: 'headsUp',
          href: p('/briefings'),
          icon: Bell,
          permission: 'headsUp.view',
        },
      ],
    },
  ];
}

export interface NavModelInput {
  readonly locale: string;
  readonly brandId: BrandId;
  readonly permissions: readonly string[];
  /**
   * The tenant's entitlement keys (ADR 0018). Optional so existing
   * callers compile; omitted = no entitlements = paid entries drop.
   * Plain strings (the client context is untyped) — matching is exact.
   */
  readonly entitlements?: readonly string[];
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
      // Entitlement gate (no admin bypass — the tenant's PLAN lacks the
      // feature, not the person's permission set).
      if (item.entitlement !== undefined && !(input.entitlements ?? []).includes(item.entitlement))
        continue;
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
  const items = flattenNavItems(sections);
  const direct = items.find((item) => isNavItemActive(item, pathname));
  if (direct !== undefined) return direct;
  // A nested entry need not live under its parent's path — Approvals,
  // Schedules and Templates are all top-level routes that now hang off
  // Inspections. Without this, standing on /approvals would light
  // nothing up and hide the sub-navigation that got you there.
  return items.find((item) =>
    (item.children ?? []).some((child) => isNavChildActive(child, pathname)),
  );
}

/** One tab in a module's in-page tab strip (see {@link moduleTabsForPath}). */
export interface ModuleTab {
  /** `nav.<key>` for the module tab, `nav.child.<key>` for a child tab. */
  readonly key: NavItemKey | NavChildKey;
  readonly href: string;
  readonly active: boolean;
  /** True for the leading tab — the module's own landing. */
  readonly isParent: boolean;
}

/**
 * The in-page tab strip for the module that owns `pathname`: the module
 * itself as the leading tab, then its children (already brand- and
 * permission-filtered by {@link buildNavSections}). This is what moves the
 * sub-navigation out of the sidebar and onto the page (ADR 0014 amendment).
 *
 * Returns `undefined` when the module has no children, or when the current
 * route is deeper than a tab page — a detail, form or editor route — so the
 * strip appears on the module's list pages only, exactly as the Inspections
 * and Training tab bars already do. `pathname` must match a tab's href
 * exactly for the strip to show; a child's own sub-routes fall through.
 */
export function moduleTabsForPath(
  sections: readonly NavSection[],
  pathname: string,
): { readonly item: NavItem; readonly tabs: readonly ModuleTab[] } | undefined {
  const item = activeNavItem(sections, pathname);
  if (item?.children === undefined || item.children.length === 0) return undefined;
  const tabHrefs = [item.href, ...item.children.map((child) => child.href)];
  if (!tabHrefs.includes(pathname)) return undefined;
  // Exact equality, not the prefix match `isNavChildActive` uses: the strip
  // only renders when `pathname` IS one of the tab hrefs, and one tab's href
  // can be a prefix of another's — standing on /schedules/calendar must not
  // also light up the Schedules tab.
  const onChild = item.children.some((child) => child.href === pathname);
  const tabs: ModuleTab[] = [
    { key: item.key, href: item.href, active: !onChild, isParent: true },
    ...item.children.map((child) => ({
      key: child.key,
      href: child.href,
      active: child.href === pathname,
      isParent: false,
    })),
  ];
  return { item, tabs };
}

/**
 * The mobile tab bar: five thumb-reachable destinations, chosen from what
 * the viewer can actually open. Order is fixed — a tab bar that reorders
 * itself between sessions defeats the muscle memory that makes it worth
 * having — and the last slot is always "more", which opens the full menu.
 *
 * The caller's own queue leads: on a phone, in the field, "what is waiting
 * on me" beats browsing any register.
 */
export const MOBILE_TAB_PRIORITY: readonly NavItemKey[] = [
  'forMe',
  'issues',
  'incidents',
  'inspections',
  'actions',
  'permits',
  'fireSafety',
  'coshh',
  'rams',
  'analytics',
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

/** Icons for the sub-nav entries. */
export const NAV_CHILD_ICON: Record<NavChildKey, LucideIcon> = {
  templates: FileStack,
  schedules: CalendarClock,
  schedulesCalendar: CalendarDays,
  approvals: BadgeCheck,
  permitsBoard: ClipboardCheck,
  permitsTypes: FileStack,
  coshhPointOfWork: FlaskConical,
  coshhLev: Wrench,
  ramsLibrary: FileStack,
  ramsReviews: HardHat,
  trainingMe: CircleUserRound,
  trainingMatrix: GraduationCap,
  trainingCompliance: BadgeCheck,
  trainingRequirements: FileStack,
  fireLogbook: Flame,
  fireSafetySettings: Settings,
  incidentInvestigations: Microscope,
  issuesQrCodes: QrCode,
  issuesCategories: FolderOpen,
  actionsCategories: FolderOpen,
  contractorsGate: HardHat,
  contractorsCalendar: CalendarDays,
};
