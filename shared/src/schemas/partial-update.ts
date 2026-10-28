import { z } from 'zod';

/**
 * PATCH/PUT shape builder for a create-time zod object schema.
 *
 * Invariant: an update parsed through this builder must contain EXACTLY the
 * keys the client sent — create-time defaults never ride into a DB write.
 * zod v4 (applied `.default()` inside `.partial()`) breaks this: a bare
 * `{ note }` PATCH comes back carrying every defaulted field
 * (`sharePct: 0`, `billingKmMultiplier: 2`, `vehicleComponent: 'TRUCK'`,
 * `isActive: true`, …) and clobbers the stored values on write. The repo is
 * pinned to zod v3, where `.partial()` leaves omitted keys out of the parsed
 * result, so the invariant holds with the plain public API.
 *
 * This builder stays the single wire point for every PATCH schema so the
 * invariant is documented once and, if zod is ever re-bumped, the v4
 * mitigation (strip every `ZodDefault` reachable through `ZodOptional` /
 * `ZodNullable` wrappers before `.partial()`, then mirror the unknown-keys
 * policy from `def.catchall`) lands here and nowhere else.
 *
 * zod v3 `.partial()` preserves the source schema's unknown-keys policy
 * (strict → strict, loose → loose, strip → strip — the object `_def` is
 * spread), pinned by `partial-update.test.ts`. Object-level refinements
 * attached to the create schema are NOT carried over (`.partial()` keeps only
 * the field shape); every schema routed through this builder relies on
 * field-level rules only — a future schema that leans on object-level
 * `superRefine` for update safety must not be routed here without carrying
 * the refinement.
 */
export function partialUpdateSchema<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
) {
  return schema.partial();
}
