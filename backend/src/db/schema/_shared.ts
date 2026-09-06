import { text } from 'drizzle-orm/pg-core';

// Application-owned enum values; PostgreSQL stores unrestricted text columns.
export function applicationEnum<const Values extends readonly [string, ...string[]]>(values: Values) {
  const builder = (name: string) => text(name, { enum: values });
  return Object.assign(builder, { enumValues: values });
}
