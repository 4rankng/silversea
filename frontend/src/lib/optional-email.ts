import { baseCreateUserSchema } from '@tingting/shared';

/** Optional UI email fields share the API's address validation — the email
 *  field is read from the base object schema so this validator does not depend
 *  on how the exported `createUserSchema`'s cross-field refine is represented
 *  (zod v3 wraps it in effects without `.shape`; v4 attaches checks). */
export function isValidOptionalEmail(value: string): boolean {
  const email = value.trim();
  return email === '' || baseCreateUserSchema.shape.email.safeParse(email).success;
}
