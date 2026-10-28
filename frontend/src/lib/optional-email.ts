import { baseCreateUserSchema } from '@tingting/shared';

/** Optional UI email fields share the API's address validation — the email
 *  field is read from the base object schema (the exported `createUserSchema`
 *  wraps it in a cross-field refine, which carries no `.shape`). */
export function isValidOptionalEmail(value: string): boolean {
  const email = value.trim();
  return email === '' || baseCreateUserSchema.shape.email.safeParse(email).success;
}
