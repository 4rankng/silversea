import { z } from 'zod';

/**
 * PATCH/PUT shape builder for a create-time zod object schema.
 *
 * zod v3's `.partial()` left create-time defaults out of the parsed result
 * when a key was absent, so a bare PATCH parsed from `{ note }` carried only
 * `note` and the DB update wrote exactly that column. zod v4 applies
 * `ZodDefault` inside `.partial()` — the default now wins over the optional
 * wrapper — so the same `{ note }` PATCH would come back carrying every
 * defaulted field (`sharePct: 0`, `billingKmMultiplier: 2`,
 * `vehicleComponent: 'TRUCK'`, `isActive: true`, …) and clobber the stored
 * values on write.
 *
 * The builder strips every `ZodDefault` reachable through `ZodOptional` /
 * `ZodNullable` wrappers (`.default(x).nullable()` and `.nullable().default(x)`
 * orderings both hide a default at the top level), then makes each field
 * optional: absent key → absent from the parsed output → "leave the stored
 * value unchanged", while an explicitly sent value still parses and coerces
 * exactly like the create schema does.
 *
 * The source schema's unknown-keys policy is mirrored (strict → strict, loose
 * → loose, strip → strip) so a PUT payload carrying an unknown key behaves
 * like the create schema. Object-level refinements attached to the create
 * schema are NOT carried over (v4 keeps no public handle to copy them); every
 * schema routed through this builder relies on field-level rules only — a
 * future schema that leans on object-level `superRefine` for update safety
 * must not be routed here without carrying the refinement.
 */

/** Runtime strip: one ZodDefault removed, through an outer ZodOptional /
 *  ZodNullable wrapper when present. Returns null when no default is found. */
function withoutDefault(field: z.ZodType): z.ZodType | null {
  if (field instanceof z.ZodDefault) return field.removeDefault() as z.ZodType;
  if (field instanceof z.ZodOptional) {
    // v4's unwrap() widens to the core $ZodType interface; the reconstructed
    // wrappers only need the value-level schema, so narrow it back.
    const inner = withoutDefault(field.unwrap() as z.ZodType);
    return inner ? z.optional(inner) : null;
  }
  if (field instanceof z.ZodNullable) {
    const inner = withoutDefault(field.unwrap() as z.ZodType);
    return inner ? z.nullable(inner) : null;
  }
  return null;
}

/** Type-level counterpart of the runtime strip. The `infer … extends` bounds
 *  keep every branch provably a $ZodType so the mapped shapes below stay valid
 *  zod object shapes. */
type StrippedField<Field> = Field extends z.ZodDefault<infer Inner extends z.core.$ZodType>
  ? Inner
  : Field extends z.ZodOptional<infer Inner extends z.core.$ZodType>
    ? Inner extends z.ZodDefault<infer Deep extends z.core.$ZodType>
      ? z.ZodOptional<Deep>
      : Field
    : Field extends z.ZodNullable<infer Inner extends z.core.$ZodType>
      ? Inner extends z.ZodDefault<infer Deep extends z.core.$ZodType>
        ? z.ZodNullable<Deep>
        : Field
      : Field;

type Stripped<Shape extends z.core.$ZodShape> = { [K in keyof Shape]: StrippedField<Shape[K]> };
/** v4 `.partial()` wraps every field in ZodOptional. */
type AllOptional<Shape extends z.core.$ZodShape> = { [K in keyof Shape]: z.ZodOptional<Shape[K]> };

export function partialUpdateSchema<Shape extends z.core.$ZodShape>(
  schema: z.ZodObject<Shape>,
): z.ZodObject<AllOptional<Stripped<Shape>>> {
  const stripped = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [
      key,
      withoutDefault(field as z.ZodType) ?? field,
    ]),
  );
  // The rebuilt object's runtime shape is exactly the declared return type:
  // each stripped field wrapped in ZodOptional by `.partial()`.
  const rebuilt = z.object(stripped).partial() as z.ZodObject<AllOptional<Stripped<Shape>>>;
  // v4 encodes the unknown-keys policy on `def.catchall`: strict objects carry
  // a `never` catchall, loose ones an `unknown` catchall, strip-mode none.
  const catchall = (schema.def as { catchall?: { def?: { type?: string } } | null }).catchall;
  const policy = catchall?.def?.type;
  if (policy === 'never') return rebuilt.strict() as z.ZodObject<AllOptional<Stripped<Shape>>>;
  if (policy === 'unknown') return rebuilt.loose() as z.ZodObject<AllOptional<Stripped<Shape>>>;
  return rebuilt;
}
