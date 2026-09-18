import { defineConfig } from 'drizzle-kit';

// 20260918_12: drizzle-kit must NEVER fall back to a hardcoded database —
// the old `|| 'postgres://…5442/silversea'` default pointed at the SIBLING
// checkout's container and silently migrated the wrong database. Rules:
//   - `generate` never touches a database: a placeholder URL is fine.
//   - everything else (migrate/push/studio) requires an explicit
//     DATABASE_URL and exits loudly without one — a silent wrong-DB default
//     is exactly the failure mode this guard exists for.
const command = process.argv[2] ?? '';
const databaseUrl = process.env.DATABASE_URL
  ?? (command === 'generate' ? 'postgres://placeholder:unused@db-does-not-exist/generate-only' : undefined);

if (!databaseUrl) {
  console.error(
    '[drizzle-kit] DATABASE_URL is required for this command — refusing to guess a database.\n'
    + '  Example: DATABASE_URL=\'postgres://postgres:postgres@localhost:5441/silversea\' pnpm db:migrate',
  );
  process.exit(1);
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // Legacy journal indices differ from file prefixes. Timestamp prefixes avoid
  // overwriting an existing snapshot when generating the next migration.
  migrations: { prefix: 'timestamp' },
  dbCredentials: {
    url: databaseUrl,
  },
});
