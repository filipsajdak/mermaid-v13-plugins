import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'harness/out/**', 'coverage/**'],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // v13 plugins hold no `as` crutches; a cast must say why it is safe.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Plugins run without a DOM and depend only on @mermaid-js/core.
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'document', 'window', 'navigator', 'globalThis'],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@mermaid-js/core(/|$)|\\.{1,2}/)',
              message: 'A plugin imports only @mermaid-js/core and its own files.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['harness/**/*.mjs', 'test/**/*.ts', 'packages/*/test/**/*.ts', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Tests read fixtures and SVG markup whose shape they assert anyway.
    files: ['test/**/*.ts', 'packages/*/test/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
