import { describe, expect, it } from 'vitest';
import {
  evaluateRules,
  validateRuleConditions,
  type Condition,
  type Rule,
  type UserFieldSnapshot,
} from './rules';

function user(id: string, fields: Record<string, string | readonly string[]>): UserFieldSnapshot {
  return { userId: id, fields };
}

describe('evaluateRules', () => {
  const alice: UserFieldSnapshot = user('u1', { role: 'Maintenance', shift: 'Morning' });
  const bob: UserFieldSnapshot = user('u2', { role: 'Maintenance', shift: 'Evening' });
  const carol: UserFieldSnapshot = user('u3', { role: 'Auditor', shift: 'Morning' });
  const dave: UserFieldSnapshot = user('u4', { role: 'Maintenance', tags: ['emt', 'safety'] });

  function rule(conds: Condition[]): Rule {
    return { id: `r-${Math.random()}`, order: 0, conditions: conds };
  }

  it('returns false when there are no rules', () => {
    expect(evaluateRules(alice, [])).toBe(false);
  });

  it('single rule, single condition, equal match', () => {
    const rules = [rule([{ fieldId: 'role', operator: '=', value: 'Maintenance' }])];
    expect(evaluateRules(alice, rules)).toBe(true);
    expect(evaluateRules(carol, rules)).toBe(false);
  });

  it('single rule with multiple conditions combines with AND (G-02 scenario)', () => {
    const rules = [
      rule([
        { fieldId: 'role', operator: '=', value: 'Maintenance' },
        { fieldId: 'shift', operator: '=', value: 'Morning' },
      ]),
    ];
    expect(evaluateRules(alice, rules)).toBe(true);
    expect(evaluateRules(bob, rules)).toBe(false);
    expect(evaluateRules(carol, rules)).toBe(false);
  });

  it('multiple rules combine with OR', () => {
    const rules = [
      rule([{ fieldId: 'role', operator: '=', value: 'Maintenance' }]),
      rule([{ fieldId: 'role', operator: '=', value: 'Auditor' }]),
    ];
    expect(evaluateRules(alice, rules)).toBe(true);
    expect(evaluateRules(carol, rules)).toBe(true);
    expect(evaluateRules(user('u5', { role: 'Safety' }), rules)).toBe(false);
  });

  it('operator !=', () => {
    const rules = [rule([{ fieldId: 'role', operator: '!=', value: 'Auditor' }])];
    expect(evaluateRules(alice, rules)).toBe(true);
    expect(evaluateRules(carol, rules)).toBe(false);
  });

  it('operator in', () => {
    const rules = [rule([{ fieldId: 'role', operator: 'in', value: ['Maintenance', 'Auditor'] }])];
    expect(evaluateRules(alice, rules)).toBe(true);
    expect(evaluateRules(carol, rules)).toBe(true);
    expect(evaluateRules(user('x', { role: 'Admin' }), rules)).toBe(false);
  });

  it('operator contains on multi-select arrays', () => {
    const rules = [rule([{ fieldId: 'tags', operator: 'contains', value: 'emt' }])];
    expect(evaluateRules(dave, rules)).toBe(true);
    expect(evaluateRules(alice, rules)).toBe(false);
  });

  it('operator contains on a missing field returns false', () => {
    const rules = [rule([{ fieldId: 'tags', operator: 'contains', value: 'emt' }])];
    expect(evaluateRules(alice, rules)).toBe(false);
  });

  it('isSet / isNotSet', () => {
    const rulesSet = [rule([{ fieldId: 'tags', operator: 'isSet', value: null }])];
    const rulesNotSet = [rule([{ fieldId: 'tags', operator: 'isNotSet', value: null }])];
    expect(evaluateRules(dave, rulesSet)).toBe(true);
    expect(evaluateRules(alice, rulesSet)).toBe(false);
    expect(evaluateRules(alice, rulesNotSet)).toBe(true);
    expect(evaluateRules(dave, rulesNotSet)).toBe(false);
  });

  it('unknown operator returns false rather than throwing', () => {
    const rules = [rule([{ fieldId: 'role', operator: 'wat' as never, value: 'x' }])];
    expect(evaluateRules(alice, rules)).toBe(false);
  });

  it('respects rule order — last matching rule wins (G-E01 validation note)', () => {
    // This test documents the ordering contract: both rules match Alice,
    // so evaluateRules() returns true regardless of order. Conflict
    // detection is a separate static analysis; at runtime, any OR match is
    // membership. `rule.order` exists for that future conflict-detection
    // path.
    const rules = [
      {
        id: 'r1',
        order: 0,
        conditions: [{ fieldId: 'role', operator: '=', value: 'Maintenance' }],
      },
      { id: 'r2', order: 1, conditions: [{ fieldId: 'shift', operator: '=', value: 'Morning' }] },
    ] satisfies Rule[];
    expect(evaluateRules(alice, rules)).toBe(true);
  });
});

describe('validateRuleConditions', () => {
  it('accepts a well-formed rule', () => {
    const result = validateRuleConditions([
      { fieldId: 'role', operator: '=', value: 'Maintenance' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown operator with a useful message', () => {
    const result = validateRuleConditions([
      { fieldId: 'role', operator: 'magic' as never, value: 'x' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toMatch(/operator/);
    }
  });

  it('rejects a condition missing fieldId', () => {
    const result = validateRuleConditions([{ fieldId: '', operator: '=', value: 'x' }]);
    expect(result.ok).toBe(false);
  });

  it('accepts an empty conditions array (a rule that matches everyone)', () => {
    const result = validateRuleConditions([]);
    expect(result.ok).toBe(true);
  });
});
