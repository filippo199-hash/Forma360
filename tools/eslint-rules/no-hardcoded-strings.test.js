/* eslint-env node */
/**
 * Unit tests for the custom no-hardcoded-strings rule.
 * Uses ESLint's RuleTester directly — no vitest involvement, because the
 * rule file is plain CommonJS and we want to keep tools/ free of workspace
 * entanglement.
 *
 * Run via: `node tools/eslint-rules/no-hardcoded-strings.test.js`
 * (Invoked from CI by the package.json `test:eslint-rules` script.)
 */
const { RuleTester } = require('eslint');
const rule = require('./no-hardcoded-strings');

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-hardcoded-strings', rule, {
  valid: [
    // t(...) call is the happy path.
    { code: `const X = () => <h1>{t('auth.signIn.title')}</h1>;` },
    // Empty / whitespace-only JSX text is fine.
    { code: `const X = () => <div>   </div>;` },
    // Punctuation / non-letters is fine (spacers, arrows, bullet points).
    { code: `const X = () => <span>→</span>;` },
    // Numbers and ids are fine.
    { code: `const X = () => <span>123</span>;` },
    // Non-translatable attrs (id, className, data-*) are not checked.
    { code: `const X = () => <div id="foo" className="x">{t('k')}</div>;` },
    { code: `const X = () => <div data-testid="row">{t('k')}</div>;` },
    // aria-label from a t() call is fine.
    { code: `const X = () => <button aria-label={t('close')} />;` },
    // Static non-letter aria-label is fine.
    { code: `const X = () => <button aria-label="×" />;` },
  ],

  invalid: [
    {
      code: `const X = () => <h1>Hello world</h1>;`,
      errors: [{ messageId: 'textNode' }],
    },
    {
      code: `const X = () => <button>Sign in</button>;`,
      errors: [{ messageId: 'textNode' }],
    },
    {
      code: `const X = () => <input placeholder="Enter email" />;`,
      errors: [{ messageId: 'translatableProp' }],
    },
    {
      code: `const X = () => <button aria-label="Close dialog" />;`,
      errors: [{ messageId: 'translatableProp' }],
    },
    {
      code: `const X = () => <img alt="Company logo" />;`,
      errors: [{ messageId: 'translatableProp' }],
    },
    {
      code: `const X = () => <button title={\`Close dialog\`} />;`,
      errors: [{ messageId: 'translatableProp' }],
    },
  ],
});

// eslint-disable-next-line no-console
console.log('no-hardcoded-strings: all RuleTester cases passed.');
