// @ts-check
import { createRequire } from 'node:module';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const noHardcodedStrings = require('./tools/eslint-rules/no-hardcoded-strings.js');

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/.playwright/**',
      'tools/**',
      '**/*.config.{js,mjs,cjs}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    plugins: {
      forma360: { rules: { 'no-hardcoded-strings': noHardcodedStrings } },
    },
    rules: {
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  // Enforce the i18n rule on React / JSX / TSX source only. Server files,
  // tests, scripts, and config files are exempt because they either don't
  // produce user-facing strings or deliberately use English literals
  // (error messages, log strings).
  {
    files: ['apps/web/app/**/*.tsx', 'packages/ui/src/**/*.tsx'],
    rules: {
      'forma360/no-hardcoded-strings': 'error',
    },
  },
  // The one file under `app/` that CANNOT translate its copy.
  //
  // `global-error.tsx` replaces the ROOT layout, so it renders with no
  // `NextIntlClientProvider` above it — calling `t()` there would throw
  // inside the boundary whose entire job is to be the thing that cannot
  // throw. That is not hypothetical: NR3-01 was a provider calling
  // `useTranslations` where none was mounted, and it 500'd every public
  // share page.
  //
  // This exemption is narrow on purpose (one path, not a directory) and
  // it is guarded from the other side: `error-boundaries.test.ts` asserts
  // the file imports nothing from `next-intl`, so it cannot quietly
  // become "somebody forgot to translate this".
  {
    files: ['apps/web/app/global-error.tsx'],
    rules: {
      'forma360/no-hardcoded-strings': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
);
