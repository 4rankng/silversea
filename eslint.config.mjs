import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Non-source / generated / tooling dirs — not linted from the root.
  // The frontend package has its own eslint.config.js + lint script with
  // React/TanStack rules; backend & shared are covered here.
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/drizzle/**',
      // Generated output & data
      'uploads/**',
      'test-results/**',
      'qa-screenshots/**',
      'graphify-out/**',
      // Docs, plans, and notes
      'docs/**',
      'plans/**',
      'memory/**',
      '.claude/**',
      // Understand-Anything knowledge graph + transient .trash-* snapshots
      // are gitignored plugin output, not lintable source.
      '.ua/**',
      // `make deploy` build worktrees — full repo copies of past states,
      // not source of truth.
      '.deploy-worktrees/**',
      // Tooling & deployment scripts
      'deploy/**',
      'e2e/**',
      'qa/**',
      'wireframe/**',
      // Frontend has its own eslint.config.js + lint script (React/TanStack rules).
      // Linting it from here triggers a root×frontend config merge with false
      // positives; lint frontend via `pnpm --filter frontend lint` instead.
      'frontend/**',
      // JS/MJS/CJS are config (vite/eslint/drizzle) or throwaway QA/puppeteer
      // scripts — out of scope for the TS source lint.
      '**/*.{js,mjs,cjs}',
      // Config .ts files are not part of any package's tsconfig include.
      '**/*.config.ts',
      '**/*.config.mjs',
    ],
  },

  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        // Monorepo with multiple tsconfig.json (frontend/backend/shared).
        // Pin the root so the parser does not error on ambiguous candidates.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // Permit ambient `declare global { namespace Express { ... } }` blocks —
      // the canonical way to augment Express's Request type. Still flags real
      // namespace usage in application code.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  }
);
