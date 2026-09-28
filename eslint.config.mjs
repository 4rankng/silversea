// @ts-check
/**
 * Repo-root ESLint flat config.
 *
 * WHY THIS FILE EXISTS (card 20260928_154)
 * ---------------------------------------
 * `pnpm lint` at the repo root used to abort with
 * `ESLint couldn't find an eslint.config.(js|mjs|cjs) file`, even though it is
 * the documented gate in `.claude/CLAUDE.md` (Commands) and
 * `testplan/roles/README.md` §6. Only `frontend/eslint.config.js` existed, and
 * `backend/` had no lint coverage at all.
 *
 * WHAT IT DOES
 * ------------
 * 1. Re-uses the FRONTEND config verbatim, re-based onto `frontend/`, so the
 *    root gate is exactly as strict as `cd frontend && pnpm lint` (including
 *    the `@tingting/*` custom rules). Nothing is weakened.
 * 2. Adds a BACKEND block that had no lint coverage at all: TypeScript
 *    recommended + `no-unused-vars`, parsed with `backend/tsconfig.json` and
 *    node globals.
 * 3. Adds a root block for `scripts/`, `shared/` and the QA harness under
 *    `testplan/qa/` (node globals, no type-aware rules).
 *
 * WHY createRequire FROM frontend/package.json
 * --------------------------------------------
 * pnpm's node_modules is strict: `@eslint/js`, `globals`,
 * `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh` are declared
 * only in `frontend/package.json`, so the root cannot import them directly.
 * Re-declaring them at the root would duplicate version pins and invite drift.
 * This repo already uses exactly this pattern for the same reason — see
 * `testplan/qa/scripts/ui-filter-audit-20260927.mjs`, which resolves
 * `@playwright/test` through `frontend/package.json` for the same reason.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'eslint/config';

const REPO = path.dirname(fileURLToPath(import.meta.url));
const fromFrontend = createRequire(path.join(REPO, 'frontend', 'package.json'));

const globals = fromFrontend('globals');
const tseslint = fromFrontend('typescript-eslint');
const frontendConfig = (await import('./frontend/eslint.config.js')).default;

/**
 * Re-base every config object from the frontend onto `frontend/`.
 *
 * Without this, the frontend's `files: ['**\/*.{ts,tsx}']` and its
 * `tsconfigRootDir: <frontend>` would be evaluated against the repo root, so a
 * root-level run would try to type-check `backend/**` with the frontend
 * tsconfig and fail on every file.
 */
const scopedToFrontend = frontendConfig.map((entry) =>
  entry.basePath ? entry : { ...entry, basePath: './frontend' },
);

export default defineConfig([
  {
    // Repo-wide ignores. `scripts/`, `shared/`, `backend/`, `frontend/` are
    // covered by the blocks below; what must never be linted is build output,
    // vendored UI source, and generated/derived evidence.
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.pnpm-store/**',
      // Vendored Untitled UI base — upstream canonical source, never edited here.
      'frontend/src/components/untitled-ui/**',
      // Generated evidence (gitignored) and driver scratch.
      '**/testplan/qa/evidence/**',
      'qa/**',
      // Python e2e harness.
      'e2e/**',
      'e2e/**',
      // `shared/tsconfig.json` sets `exclude: ["src/**/*.test.ts"]`, so the
      // project service cannot resolve them. Type-aware linting is therefore
      // impossible for these without changing build output — they get the
      // non-type-aware block at the bottom instead.
      // Root scratch files in shared/ (test-zod*.ts) sit outside `include`.
      '**/shared/src/**/*.test.ts',
      '**/shared/test-zod.ts',
      '**/shared/test-zod-null.ts',
      // Throwaway browser probes that live next to the code they poke. None
      // is referenced by any documented command; they are session scratch.
      // `role-ui-sweep.mjs` and `role-ui-sweep-report.mjs` are NOT ignored —
      // CLAUDE.md documents the former as the all-route sweep entry point.
      '**/frontend/cus-qa*.mjs',
      '**/frontend/probe-*.mjs',
      '**/frontend/drill*.mjs',
      '**/frontend/shotall.mjs',
      '**/frontend/drv-repro.mjs',
      '**/frontend/mobile-ux-sweep.mjs',
      '**/frontend/dispatch-toolbar-shot.mjs',
      '**/frontend/qa/tmp-*.mjs',
      // Archived harness scripts, preserved verbatim as history (qa/README
      // "scripts/_legacy/ — archived scripts"). These are .sql and .py only:
      // the one .mjs that lived here was a 34-line truncated fragment that has
      // never parsed in any revision (card 20260928_187), so it was removed
      // rather than ignored. Nothing lintable remains, so nothing is ignored.
      //
      // '**/backend/scripts/archive/**' used to be listed here. It is gone
      // because the broader '**/backend/scripts/**' below already covers it —
      // keeping both implied archive was handled separately when it is not.

      // Card 20260928_154 follow-up: these trees are one-off tooling with NO
      // tsconfig, so projectService cannot parse them and every file reports a
      // "Parsing error" that says nothing about code quality. The gate covers
      // the real source trees (frontend/, backend/src, shared/, testplan/qa);
      // these are reported separately rather than inflating the gate with noise.
      '**/backend/scripts/**',
      '**/backend/drizzle.config.ts',
      '**/frontend/design-lock/expectations/**',
      '**/frontend/scripts/**',
      'frontend/*.mjs',
    ],
  },

  // ---- Frontend: the existing config, unchanged but correctly based -------
  ...scopedToFrontend,

  // ---- Backend: previously had NO lint coverage at all -------------------
  {
    files: ['backend/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: path.join(REPO, 'backend'),
      },
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // TS resolves undefined identifiers itself; base no-undef false-positives
      // on ambient types and globals the tsconfig declares.
      'no-undef': 'off',
      'no-console': ['warn', { allow: ['error', 'warn'] }],
    },
  },

  // ---- Shared package ----------------------------------------------------
  {
    files: ['shared/**/*.ts'],
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: path.join(REPO, 'shared'),
      },
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'off',
    },
  },

  // ---- Root tooling: scripts/, testplan/qa/ harness + standalone drivers ---
  // These run in node and drive a browser via puppeteer/playwright, so page
  // globals (document/window/getComputedStyle) are intentional inside
  // page.evaluate callbacks.
  {
    files: ['testplan/qa/**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      globals: { ...globals.node, ...globals.es2022, ...globals.browser },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },

  // ---- Type-aware linting is impossible for these (see the ignore list) ----
  // `shared/tsconfig.json` excludes `src/**/*.test.ts`, so projectService has
  // no project to resolve them against. Rather than leave them unlinted or
  // mutate the build tsconfig, they get the syntax-level rules only.
  {
    files: ['shared/src/**/*.test.ts'],
    ...tseslint.configs.disableTypeChecked,
    plugins: { '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
]);
