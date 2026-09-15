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
      /** Match `const queryKey = ['...', ...]` (or *QueryKey) — the shorthand
       * evasion of the Property rule: declare an array, then pass it as
       * `queryKey,`. Flag the declaration itself. */
      VariableDeclarator(node) {
        if (
          node.id.type === 'Identifier' &&
          /queryKey$/i.test(node.id.name) &&
          node.init?.type === 'ArrayExpression'
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
// T4.1.4 — Custom rule: ban native <select> in JSX (macOS picker visual bug)
//
// Native selects render OS-owned menus (translucent macOS dropdowns) that
// ignore app theming and overflow their containers — a recurring visual bug.
// All selects must use the shared Untitled UI adapter
// (design-system/forms/UuiSelectField). The vendored UUI base keeps its
// native-select accessibility fallback.
// ---------------------------------------------------------------------------
const noNativeSelect = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ban native <select> in JSX — use UuiSelectField from design-system/forms',
    },
    schema: [],
    messages: {
      noNativeSelect:
        "Native <select> renders the OS-styled picker menu (the recurring macOS dropdown visual bug). Use UuiSelectField from 'design-system/forms/UuiSelectField' (or SelectField for the children API).",
      noNativeSelectImport:
        "NativeSelect (select-native.tsx) is the vendored UUI screen-reader accessibility fallback, not a general-purpose control — importing it elsewhere reintroduces the OS-styled picker menu (the recurring macOS dropdown visual bug). Use UuiSelectField from 'design-system/forms/UuiSelectField' instead.",
    },
  },
  create(context) {
    return {
      /** JSX <select> elements, including member expressions like Foo.Select */
      JSXOpeningElement(node) {
        const name = node.name;
        const isPlainSelect =
          name.type === 'JSXIdentifier' && name.name === 'select';
        const isMemberSelect =
          name.type === 'JSXMemberExpression' &&
          name.property.name === 'Select';
        if (isPlainSelect || isMemberSelect) {
          context.report({ node, messageId: 'noNativeSelect' });
        }
      },
      /** Importing the vendored accessibility-fallback NativeSelect from outside its own module. */
      ImportDeclaration(node) {
        if (!/\/select\/select-native$/.test(node.source.value)) return;
        context.report({ node, messageId: 'noNativeSelectImport' });
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
    'no-native-select': noNativeSelect,
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
      // Off: this codebase co-locates helpers/types/constants with the
      // components that own them (50+ files, both directions — e.g. nav
      // helpers in Layout.tsx, presenter components in dashboard-presenters).
      // Splitting every file to satisfy this rule buys only finer-grained HMR
      // in dev; it has no production effect. Revisit only if fast-refresh
      // granularity becomes a real bottleneck.
      'react-refresh/only-export-components': 'off',

      // ---- General rules ----
      'no-console': ['warn', { allow: ['error', 'warn'] }],

      // ---- TingTing custom rules ----
      '@tingting/no-bare-query-key': 'error',
      '@tingting/no-any': 'warn',
      '@tingting/no-native-select': 'error',
    },
  },

  // Test files may keep native <select> as component doubles: they render in
  // jsdom (never shown to users, so the OS-picker visual bug cannot occur)
  // and `fireEvent.change` semantics rely on a real select element.
  {
    files: ['**/*.test.tsx', '**/*.test.ts'],
    rules: {
      '@tingting/no-native-select': 'off',
    },
  },

  // Untitled UI CLI-managed components are vendored canonical source — never
  // edited locally, so stylistic rules that fire on upstream code are relaxed.
  // The UUI select base also owns the one sanctioned native <select>: its
  // screen-reader accessibility fallback (select-native.tsx), so the
  // no-native-select guard is off there.
  {
    files: ['src/components/untitled-ui/**'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      'prefer-const': 'off',
      '@tingting/no-native-select': 'off',
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
