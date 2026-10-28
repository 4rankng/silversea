import { createUserSchema } from '@tingting/shared';

/** Optional UI email fields share the API's address validation. (zod v4
 *  attaches refinements without an effects wrapper, so the object shape is
 *  reached directly — v3's `.innerType()` hop is gone.) */
export function isValidOptionalEmail(value: string): boolean {
  const email = value.trim();
  return email === '' || createUserSchema.shape.email.safeParse(email).success;
}
