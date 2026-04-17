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
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
);
