import { createUserSchema } from '@tingting/shared';

/** Optional UI email fields share the API's address validation. */
export function isValidOptionalEmail(value: string): boolean {
  const email = value.trim();
  return email === '' || createUserSchema.innerType().shape.email.safeParse(email).success;
}
