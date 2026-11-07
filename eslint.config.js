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
    // swimlane-beta is the flowchart syntax laid out in lanes: the plugin reuses the first-party
    // flowchart plugin's parser and renderer, and lays out with our lifted swimlane engine.
    files: ['packages/diagram-swimlane/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex:
                '^(?!@mermaid-js/core(/|$)|@mermaid-js/diagram-flowchart$|@mermaid-v13-plugins/swimlane-engine$|\\.{1,2}/)',
              message:
                'The swimlane plugin imports only @mermaid-js/core, the flowchart plugin, the swimlane engine and its own files.',
            },
          ],
        },
      ],
    },
  },
  {
    // bpmn-beta is laid out in pools and lanes by our lifted swimlane engine, as in v12.
    files: ['packages/diagram-bpmn/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@mermaid-js/core(/|$)|@mermaid-v13-plugins/swimlane-engine$|\\.{1,2}/)',
              message:
                'The BPMN plugin imports only @mermaid-js/core, the swimlane engine and its own files.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'harness/**/*.mjs',
      'packages/*/scripts/**/*.mjs',
      'test/**/*.ts',
      'packages/*/test/**/*.ts',
      'eslint.config.js',
    ],
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
  {
    // The swimlane engine is lifted from mermaid v12 and kept close to it, so a diff against v12
    // stays readable. v12 linted it without the type-checked strict rules; the DOM ban and the
    // import rule below still hold. New code in the package is held to them by review.
    files: ['packages/swimlane-engine/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-deprecated': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      // The engine imports nothing but its own files.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^(?!\\.{1,2}/)', message: 'The swimlane engine imports only its own files.' },
          ],
        },
      ],
    },
  },
  {
    // Its v12 specs also use vitest and node.
    files: [
      'packages/swimlane-engine/src/**/*.spec.ts',
      'packages/swimlane-engine/src/**/__tests__/**/*.ts',
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-imports': 'off', 'no-restricted-globals': 'off' },
  },
);
