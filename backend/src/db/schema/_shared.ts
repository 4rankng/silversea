
import {
  customType, text,
} from 'drizzle-orm/pg-core';
const vector1536Builder = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
});

export const vectorColumn1536 = vector1536Builder;


// Application-owned enum values; PostgreSQL stores unrestricted text columns.
export function applicationEnum<const Values extends readonly [string, ...string[]]>(values: Values) {
  const builder = (name: string) => text(name, { enum: values });
  return Object.assign(builder, { enumValues: values });
}
