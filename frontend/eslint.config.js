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

      // Card 20260928_154. THESE LIVE HERE, NOT AT THE REPO ROOT.
      //
      // ESLint v10 resolves each file against the NEAREST config, so everything
      // under frontend/ is linted by THIS file and never by the root
      // eslint.config.mjs. The root config lists twelve frontend ignores
      // (`**/frontend/scripts/**`, `frontend/*.mjs`,
      // `**/frontend/design-lock/expectations/**`, the cus-qa*/probe-*/drill*
      // probes …) and every one of them is dead: it looks right, it is never
      // consulted. The visible symptom was 29 "Parsing error: No
      // tsconfigRootDir was set" errors for build scripts that have no defect
      // at all — they live in no tsconfig, so the type-aware parser cannot
      // read them, and the errors said nothing about code quality.
      //
      // These trees are one-off tooling with no tsconfig, so they are excluded
      // for the same reason `*.config.ts` is above. Moved here so the exclusion
      // is actually in force. If one of these is later promoted to real
      // source, delete its line here rather than re-adding it at the root,
      // where it would again do nothing.
      'scripts/**',
      'design-lock/expectations/**',
      // Throwaway browser probes that live next to the code they poke. None is
      // referenced by a documented command; they are session scratch.
      // `role-ui-sweep.mjs` and `role-ui-sweep-report.mjs` are NOT ignored —
      // .claude/CLAUDE.md documents the former as the all-route sweep entry.
      'cus-qa*.mjs',
      'probe-*.mjs',
      'drill*.mjs',
      'shotall.mjs',
      'drv-repro.mjs',
      'mobile-ux-sweep.mjs',
      'dispatch-toolbar-shot.mjs',
      'qa/tmp-*.mjs',
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
  //
  // `languageOptions` is MERGED, not replaced. Spreading
  // `tseslint.configs.disableTypeChecked` and then declaring `languageOptions`
  // wholesale below it throws away the `parserOptions` that spread installed,
  // so `projectService: false` was dropped and these files stayed on the
  // type-aware parser. That is invisible for a .mjs in a tsconfig and fatal
  // for one that is not: `role-ui-sweep.mjs` is documented in .claude/CLAUDE.md
  // as the all-route sweep entry point, so it is deliberately NOT ignored, and
  // the only thing standing between it and the gate is this block actually
  // disabling the type-aware parse.
  // `tsconfigRootDir` is set explicitly even though `projectService` is false
  // here. ESLint v10 locates `eslint.config.*` per linted file, so a file under
  // frontend/ has two candidate roots in play — this directory and the repo
  // root that re-bases the frontend blocks. typescript-eslint refuses to guess
  // between them and fails the parse with "No tsconfigRootDir was set, and
  // multiple candidate TSConfigRootDirs are present", naming that exact
  // directory pair. Pinning it here is the fix the error itself asks for, and
  // it costs nothing when type-aware linting is already off.
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      parserOptions: {
        ...tseslint.configs.disableTypeChecked.languageOptions?.parserOptions,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
  },

  // Browser harnesses (`frontend/**/*.mjs` — the Playwright/Puppeteer sweeps
  // and probes at the root and under scripts/ + design-lock/): they run in Node
  // but execute callbacks INSIDE the page
  // via `page.evaluate`/`$$eval`, where `document`, `window`, `getComputedStyle`
  // are the page's globals. Both sets are intentional, exactly like the
  // `qa/scripts/*.cjs` probes below; without this block every probe callback
  // reported a false `no-undef`. Merged for the same reason as the block above.
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['**/*.mjs'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      parserOptions: {
        ...tseslint.configs.disableTypeChecked.languageOptions?.parserOptions,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
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
