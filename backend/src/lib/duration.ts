/**
 * Parse an ms-compatible duration string — the vocabulary `JWT_EXPIRES_IN`
 * uses (`jsonwebtoken` SignOptions.expiresIn delegates to the `ms` package) —
 * into whole seconds. Pure: no config, no clock, safe for unit tests.
 *
 * Supported: a bare number of seconds ("3600") or number+unit where the unit
 * is one of s/m/h/d/w/y. Fractional values floor (observability only needs
 * whole-second precision). Returns null for anything unparseable so callers
 * can omit the field instead of guessing.
 */
const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
  y: 31_536_000,
};

export function durationStringToSeconds(input: string): number | null {
  const match = /^(\d+(?:\.\d+)?)([smhdwy]?)$/.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = match[2] || 's';
  return Math.floor(value * UNIT_SECONDS[unit]);
}
