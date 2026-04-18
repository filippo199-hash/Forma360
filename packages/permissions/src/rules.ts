/**
 * Rule-based membership evaluator.
 *
 * Pure function. Used synchronously at the router layer (validating a
 * rule on save) and asynchronously by the BullMQ reconcile jobs
 * (`group-membership-reconcile`, `site-membership-reconcile`) that
 * materialise membership into the join tables.
 *
 * Semantics (Phase 1 § 1.3):
 *   - A `Rule` is a list of `Condition`s combined with AND.
 *   - A list of rules is combined with OR — a user matches the list iff
 *     any rule in the list matches them.
 *   - An empty rule list matches nobody. An empty condition list within
 *     a rule matches everyone (treated as a permissive match).
 *   - Unknown operators or missing fields resolve to `false` — the most
 *     restrictive interpretation, so a typo never grants phantom access.
 *
 * Conflict detection (G-E01) is a separate static-analysis pass; this
 * file is the runtime evaluator.
 */

export const RULE_OPERATORS = [
  '=',
  '!=',
  'in',
  'notIn',
  'contains',
  'notContains',
  'isSet',
  'isNotSet',
] as const;

export type RuleOperator = (typeof RULE_OPERATORS)[number];

export interface Condition {
  fieldId: string;
  operator: RuleOperator;
  /**
   * For `=` / `!=`: a scalar (string / number / boolean).
   * For `in` / `notIn` / `contains` / `notContains`: an array or scalar.
   * For `isSet` / `isNotSet`: ignored.
   */
  value: unknown;
}

export interface Rule {
  id: string;
  order: number;
  conditions: readonly Condition[];
}

export interface UserFieldSnapshot {
  userId: string;
  /**
   * Field values keyed by `field.id`. Single-value fields store a string;
   * multi_select fields store a readonly string[]. The evaluator handles
   * both.
   */
  fields: Record<string, string | readonly string[] | undefined>;
}

// ─── Condition evaluators ───────────────────────────────────────────────────

function asArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function evaluateCondition(snapshot: UserFieldSnapshot, cond: Condition): boolean {
  const field = snapshot.fields[cond.fieldId];
  switch (cond.operator) {
    case '=':
      return field === cond.value;
    case '!=':
      return field !== cond.value;
    case 'in': {
      const set = asArray(cond.value);
      return typeof field === 'string' && set.includes(field);
    }
    case 'notIn': {
      const set = asArray(cond.value);
      return typeof field === 'string' && !set.includes(field);
    }
    case 'contains': {
      if (!Array.isArray(field)) return false;
      return field.includes(cond.value as string);
    }
    case 'notContains': {
      if (!Array.isArray(field)) return true;
      return !field.includes(cond.value as string);
    }
    case 'isSet':
      return field !== undefined && field !== null && (!Array.isArray(field) || field.length > 0);
    case 'isNotSet':
      return field === undefined || field === null || (Array.isArray(field) && field.length === 0);
    default:
      // Unknown operator — be restrictive. TypeScript already narrows the
      // switch above to RuleOperator so this branch only runs for data that
      // bypassed the validator.
      return false;
  }
}

/**
 * Evaluate every rule against the snapshot; return `true` as soon as any
 * rule matches (OR semantics). Returns `false` for an empty rule list.
 */
export function evaluateRules(snapshot: UserFieldSnapshot, rules: readonly Rule[]): boolean {
  for (const rule of rules) {
    // Permissive: empty conditions = match.
    if (rule.conditions.length === 0) return true;
    // AND across the conditions in this rule.
    const allMatch = rule.conditions.every((cond) => evaluateCondition(snapshot, cond));
    if (allMatch) return true;
  }
  return false;
}

// ─── Static validation (used by the router on save) ─────────────────────────

export interface ValidationIssue {
  index: number;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

/**
 * Reject obviously-broken rule data at the router boundary. Catches typos
 * in the operator (which at runtime would silently resolve to false) and
 * missing fieldId. The conflict-detection pass for G-E01 is a separate
 * function, not part of this strict validator.
 */
export function validateRuleConditions(conditions: readonly Condition[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const operators = new Set<string>(RULE_OPERATORS);
  conditions.forEach((cond, i) => {
    if (typeof cond.fieldId !== 'string' || cond.fieldId.length === 0) {
      issues.push({ index: i, message: 'fieldId is required' });
    }
    if (!operators.has(cond.operator)) {
      issues.push({ index: i, message: `unknown operator: ${cond.operator}` });
    }
  });
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
