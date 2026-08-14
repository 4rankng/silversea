// @ts-check
/**
 * TingTing ESLint flat config — ESLint 9 + typescript-eslint + React plugins.
 *
 * Custom rules:
 *   @tingting/no-bare-query-key   — Ban inline `queryKey: [...]` arrays
 *   @tingting/no-any              — Warn on `as any` / `: any` annotations
 */
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

// ---------------------------------------------------------------------------
// T4.1.2 — Custom rule: ban bare queryKey: [...]
// ---------------------------------------------------------------------------
const noBareQueryKey = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require qk.* factory for TanStack Query keys instead of inline arrays',
    },
    schema: [],
    messages: {
      bareQueryKey:
        "Use qk.* factory for query keys instead of inline arrays. Import qk from '../api/keys' or './api/keys'.",
    },
  },
  create(context) {
    return {
      /** Match `queryKey: ['...', ...]` — property with array literal value */
      Property(node) {
        if (
          node.key.type === 'Identifier' &&
          node.key.name === 'queryKey' &&
          node.value.type === 'ArrayExpression'
        ) {
          context.report({
            node,
            messageId: 'bareQueryKey',
          });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// T4.1.3 — Custom rule: warn on `as any` and `: any`
// ---------------------------------------------------------------------------
const noAny = {
  meta: {
    type: 'suggestion',
    docs: {
      description: "Warn on 'any' type usage",
    },
    schema: [],
    messages: {
      noAny: "Avoid 'any' type — use proper types or unknown.",
    },
  },
  create(context) {
    return {
      /** `as any` type assertion */
      TSAsExpression(node) {
        if (node.typeAnnotation && node.typeAnnotation.typeName) {
          const typeName = node.typeAnnotation.typeName;
          if (typeName.type === 'Identifier' && typeName.name === 'any') {
            context.report({ node, messageId: 'noAny' });
          }
        }
      },
      /** Variable / parameter / property with `: any` annotation */
      TSTypeAnnotation(node) {
        if (node.typeAnnotation && node.typeAnnotation.typeName) {
          const typeName = node.typeAnnotation.typeName;
          if (typeName.type === 'Identifier' && typeName.name === 'any') {
            context.report({ node, messageId: 'noAny' });
          }
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Local plugin container for @tingting namespace rules
// ---------------------------------------------------------------------------
const tingtingPlugin = {
  meta: { name: '@tingting/eslint-plugin', version: '0.1.0' },
  rules: {
    'no-bare-query-key': noBareQueryKey,
    'no-any': noAny,
  },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export default defineConfig([
  // Global ignores
  {
    ignores: [
      'dist/**',
      'build/**',
      // Static assets copied verbatim by Vite (incl. the service worker, which
      // uses browser globals like self/caches and isn't app source to lint).
      'public/**',
      '*.config.js',
      '*.config.mjs',
      // Config .ts files aren't in tsconfig include → projectService can't resolve them
      '*.config.ts',
      'vite.config.ts.test.js',
      // Throwaway QA/puppeteer scripts at the repo root (use node+browser globals)
      'qa-*.js',
      'screenshot.spec.js',
      // Playwright E2E specs run outside the Vite/tsconfig project → the
      // projectService cannot parse them (dedicated Python e2e/ lives at the
      // repo root; these are browser-globals test files).
      'e2e/**',
    ],
  },

  // Base JS recommended
  js.configs.recommended,

  // TypeScript recommended (disables base no-unused-vars/no-undef for TS files).
  // NOTE: spread the array itself — `tseslint.configs.recommended.rules` is
  // `undefined` because `configs.recommended` is an array, not a single config.
  ...tseslint.configs.recommended,

  // TypeScript + React files
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      '@tingting': tingtingPlugin,
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
      },
    },
    rules: {
      // ---- TypeScript rules ----
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // TS already catches undefined identifiers; base no-undef fires on JSX
      // globals and ambient types, so disable it for TS/TSX.
      'no-undef': 'off',
      // Honor the project's "any is a warning" stance (@tingting/no-any: warn).
      '@typescript-eslint/no-explicit-any': 'warn',

      // ---- React rules ----
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // ---- General rules ----
      'no-console': ['warn', { allow: ['error', 'warn'] }],

      // ---- TingTing custom rules ----
      '@tingting/no-bare-query-key': 'error',
      '@tingting/no-any': 'warn',
    },
  },

  // Untitled UI CLI-managed components are vendored canonical source — never
  // edited locally, so stylistic rules that fire on upstream code are relaxed.
  {
    files: ['src/components/untitled-ui/**'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      'prefer-const': 'off',
    },
  },

  // Plain JS/MJS files (build scripts like scripts/check-size.mjs): no
  // type-checked rules, and node globals so process/console/URL resolve.
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: globals.node,
    },
  },

  // Standalone QA probes run in Node but execute callbacks in the browser via
  // Puppeteer, so both sets of globals are intentional.
  {
    files: ['qa/scripts/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
]);
