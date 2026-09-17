import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // Legacy journal indices differ from file prefixes. Timestamp prefixes avoid
  // overwriting an existing snapshot when generating the next migration.
  migrations: { prefix: 'timestamp' },
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5441/silversea',
  },
});
