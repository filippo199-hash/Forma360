/**
 * Custom ESLint rule: no-hardcoded-strings.
 *
 * Flags user-facing English strings that have leaked past `t(...)`.
 * Specifically:
 *   - Text nodes inside JSX whose content is literal (not an expression).
 *   - String values for translatable JSX props: aria-label, title,
 *     placeholder, alt, label.
 *
 * Exempted:
 *   - Strings inside JSXExpressionContainers whose value is a call to
 *     `t(...)` or a template literal built from those calls.
 *   - Literals that are obviously non-translatable: empty, whitespace only,
 *     numeric, a single punctuation character, or matching a very simple
 *     "not a sentence" heuristic (no letters).
 *
 * File-level ignores are applied via ESLint `files` overrides in
 * eslint.config.mjs, not inside this rule.
 */

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded user-facing strings in JSX. Wrap every string in t() from next-intl.',
    },
    schema: [],
    messages: {
      textNode:
        'Hardcoded JSX text "{{text}}". Use t("key") from next-intl, then add the key to packages/i18n/messages/en.json.',
      translatableProp:
        'Hardcoded value on translatable JSX prop "{{attr}}": "{{text}}". Use t("key") from next-intl.',
    },
  },

  create(context) {
    /**
     * Strings that look non-translatable. Anything without a letter is
     * almost certainly punctuation, an id, or a unit — fine to leave.
     * We also skip empty/whitespace-only strings.
     */
    function looksNonTranslatable(raw) {
      const text = String(raw).trim();
      if (text.length === 0) return true;
      // Only flag strings that contain at least one Unicode letter. Skips
      // punctuation, math symbols (×), arrows, numerals, and unit glyphs
      // even inside otherwise-translatable attributes.
      if (!/\p{L}/u.test(text)) return true;
      return false;
    }

    const TRANSLATABLE_ATTRS = new Set([
      'aria-label',
      'aria-placeholder',
      'alt',
      'title',
      'placeholder',
      'label',
    ]);

    return {
      // <div>Hello</div>   <Foo>Hi</Foo>
      JSXText(node) {
        if (looksNonTranslatable(node.value)) return;
        context.report({
          node,
          messageId: 'textNode',
          data: { text: node.value.trim().slice(0, 60) },
        });
      },

      // aria-label="Hello"  placeholder={"Hello"}  title={`Hello`}
      JSXAttribute(node) {
        const name =
          node.name.type === 'JSXIdentifier'
            ? node.name.name
            : node.name.type === 'JSXNamespacedName'
              ? `${node.name.namespace.name}:${node.name.name.name}`
              : null;
        if (name === null) return;
        if (!TRANSLATABLE_ATTRS.has(name)) return;

        const value = node.value;
        if (value === null) return;

        // aria-label="Hello"
        if (value.type === 'Literal' && typeof value.value === 'string') {
          if (looksNonTranslatable(value.value)) return;
          context.report({
            node,
            messageId: 'translatableProp',
            data: { attr: name, text: value.value.slice(0, 60) },
          });
          return;
        }

        // aria-label={"Hello"} / aria-label={`Hello ${name}`}
        if (value.type === 'JSXExpressionContainer') {
          const expr = value.expression;
          if (expr.type === 'Literal' && typeof expr.value === 'string') {
            if (looksNonTranslatable(expr.value)) return;
            context.report({
              node,
              messageId: 'translatableProp',
              data: { attr: name, text: expr.value.slice(0, 60) },
            });
          }
          if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) {
            const raw = expr.quasis.map((q) => q.value.cooked ?? '').join('');
            if (looksNonTranslatable(raw)) return;
            context.report({
              node,
              messageId: 'translatableProp',
              data: { attr: name, text: raw.slice(0, 60) },
            });
          }
        }
      },
    };
  },
};
