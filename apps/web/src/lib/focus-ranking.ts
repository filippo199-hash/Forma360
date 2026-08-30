/**
 * The Focus ranking (review round 4) — "what should I do first?",
 * answered deterministically.
 *
 * A pure function over the my-work rows and the user's own Focus rules
 * (user_work_priorities): statutory lateness first, then how close the
 * clock is, then the kind's intrinsic weight, then the user's taught
 * boosts and demotes. No model in the loop — the same queue and the
 * same rules always produce the same order, and every entry can say WHY
 * it sits where it sits (the reasons feed the row's chip).
 */

export interface FocusRule {
  id: string;
  ruleType: 'kind' | 'keyword';
  /** A MyWorkKind for 'kind'; a lowercase substring for 'keyword'. */
  value: string;
  direction: 'boost' | 'demote';
  /** The user's own words, shown back on the chip. */
  note: string;
}

export interface FocusRow {
  kind: string;
  id: string;
  title: string;
  href: string;
  dueAt: Date | string | null;
  overdue: boolean;
}

export type FocusReason =
  | { kind: 'overdue' }
  | { kind: 'dueToday' }
  | { kind: 'dueSoon' }
  | { kind: 'boosted'; note: string }
  | { kind: 'demoted'; note: string };

export interface RankedFocusRow<T extends FocusRow> {
  row: T;
  score: number;
  reasons: FocusReason[];
}

/**
 * Intrinsic kind weights: an approval or signature blocks OTHER people,
 * an expiring qualification can stop tomorrow's job, an action is the
 * daily bread, a briefing acknowledgement is important but rarely the
 * first thing, a draft inspection waits for its author.
 */
const KIND_BASE: Record<string, number> = {
  approval: 120,
  signature: 110,
  action: 100,
  training: 90,
  acknowledgement: 80,
  inspection: 70,
};

const DAY_MS = 86_400_000;

export function rankFocus<T extends FocusRow>(
  rows: readonly T[],
  rules: readonly FocusRule[],
  now: Date,
): Array<RankedFocusRow<T>> {
  const ranked = rows.map((row): RankedFocusRow<T> => {
    let score = KIND_BASE[row.kind] ?? 50;
    const reasons: FocusReason[] = [];
    const due = row.dueAt !== null ? new Date(row.dueAt) : null;
    const dueMs = due !== null && !Number.isNaN(due.getTime()) ? due.getTime() : null;

    if (row.overdue) {
      const daysLate = dueMs !== null ? Math.max(0, (now.getTime() - dueMs) / DAY_MS) : 0;
      score += 1000 + Math.min(30, Math.floor(daysLate)) * 10;
      reasons.push({ kind: 'overdue' });
    } else if (dueMs !== null) {
      const hoursLeft = (dueMs - now.getTime()) / 3_600_000;
      if (hoursLeft <= 24) {
        score += 400;
        reasons.push({ kind: 'dueToday' });
      } else if (hoursLeft <= 24 * 7) {
        score += 200;
        reasons.push({ kind: 'dueSoon' });
      } else {
        score += 50;
      }
    }

    for (const rule of rules) {
      const matches =
        rule.ruleType === 'kind'
          ? row.kind === rule.value
          : row.title.toLowerCase().includes(rule.value);
      if (!matches) continue;
      if (rule.direction === 'boost') {
        score += 500;
        reasons.push({ kind: 'boosted', note: rule.note });
      } else {
        score -= 500;
        reasons.push({ kind: 'demoted', note: rule.note });
      }
    }

    return { row, score, reasons };
  });

  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const aDue = a.row.dueAt !== null ? new Date(a.row.dueAt).getTime() : Infinity;
    const bDue = b.row.dueAt !== null ? new Date(b.row.dueAt).getTime() : Infinity;
    if (aDue !== bDue) return aDue - bDue;
    return a.row.title.localeCompare(b.row.title);
  });

  return ranked;
}

/** The one chip a Focus row shows — its strongest claim to the slot. */
export function primaryReason(reasons: readonly FocusReason[]): FocusReason | null {
  return (
    reasons.find((r) => r.kind === 'boosted') ??
    reasons.find((r) => r.kind === 'overdue') ??
    reasons.find((r) => r.kind === 'dueToday') ??
    reasons.find((r) => r.kind === 'dueSoon') ??
    null
  );
}
