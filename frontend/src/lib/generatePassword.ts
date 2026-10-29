/**
 * Strong-password generator for the Đổi mật khẩu dialog (SIL-574): the card
 * acceptance requires the dialog to OFFER password generation (password
 * managers get the autocomplete tokens; users without one get this).
 *
 * 16 chars across four classes, at least one of each — a compact, boring
 * generator on `crypto.getRandomValues` with rejection sampling (no modulo
 * bias). Not a security primitive beyond generating a random string.
 */
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*?-_=+';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

function randomInt(max: number): number {
  // Rejection sampling: values >= limit would bias the modulo.
  const limit = Math.floor(0xFFFFFFFF / max) * max;
  const buf = new Uint32Array(1);
  let value = 0;
  do {
    crypto.getRandomValues(buf);
    value = buf[0] ?? 0;
  } while (value >= limit);
  return value % max;
}

export function generatePassword(length = 16): string {
  const size = Math.max(length, 8);
  const chars = [
    LOWER.charAt(randomInt(LOWER.length)),
    UPPER.charAt(randomInt(UPPER.length)),
    DIGITS.charAt(randomInt(DIGITS.length)),
    SYMBOLS.charAt(randomInt(SYMBOLS.length)),
  ];
  while (chars.length < size) chars.push(ALL.charAt(randomInt(ALL.length)));
  // Fisher–Yates so the guaranteed classes are not pinned to the front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join('');
}
