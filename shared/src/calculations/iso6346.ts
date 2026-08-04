/**
 * ISO 6346 shipping-container number validation.
 *
 * Ported (faithfully) from vantaiphucloc `app/utils/iso6346.py`.
 *
 * THIS MODULE IS THE SOURCE OF TRUTH (DEF-20260804-005).
 * Earlier docs referenced Wikipedia's ISO 6346 mapping (A=10, B=12, C=14, …)
 * but the app's behaviour diverges: it skips multiples of 11 in the letter
 * map (A=10, B=12, C=13, D=14, …) so no character yields a zero remainder
 * in mod 11. The Wikipedia mapping is *not* what the app validates against.
 *
 * Container numbers that validate under THIS module:
 *   - MSKU1234565
 *   - TGHU1234565
 *
 * Format: XXXXNNNNNNN
 *   - XXXX    : 4 letters (owner code)
 *   - NNNNNNN : 7 digits (6 serial + 1 check digit)
 *
 * Check digit:
 *   1. Letters are mapped to numbers (A=10, B=12, …, Z=38) — values skip
 *      multiples of 11 so no character yields a zero remainder in mod 11.
 *   2. Each of the first 10 characters is multiplied by 2^position (0-indexed).
 *   3. Sum the products.
 *   4. Check digit = sum % 11, EXCEPT if the remainder is 10 → 0.
 */

/** A=10…Z=38, skipping multiples of 11 (11, 22, 33). */
export const LETTER_MAP: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

/** 2^0 … 2^9, one per position of the first 10 characters. */
export const POWERS_2 = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512] as const;

const OWNER_RE = /^[A-Z]{4}$/;
const SERIAL_RE = /^\d{7}$/;
const FULL_RE = /^[A-Z]{4}\d{7}$/;

/** Remove hyphens/spaces and uppercase. */
export function normalizeContainerNumber(containerNumber: string): string {
  return containerNumber.replace(/[-\s]/g, '').toUpperCase().trim();
}

/** True if the number matches XXXX + 7 digits (after normalization). */
export function validateContainerFormat(containerNumber: string): boolean {
  const n = normalizeContainerNumber(containerNumber);
  return n.length === 11 && OWNER_RE.test(n.slice(0, 4)) && SERIAL_RE.test(n.slice(4));
}

/**
 * Calculate the ISO 6346 check digit for the first 10 characters (owner + serial,
 * without the check digit). Returns the digit (0–9). Remainder 10 is mapped to 0.
 */
export function calculateCheckDigit(containerNumber: string): number {
  const n = normalizeContainerNumber(containerNumber);
  if (n.length !== 10) {
    throw new Error(`Container number must be 10 characters (without check digit): ${containerNumber}`);
  }

  let total = 0;
  for (let i = 0; i < 10; i++) {
    const char = n[i];
    if (i < 4) {
      const value = LETTER_MAP[char];
      if (value === undefined) {
        throw new Error(`Invalid letter in container number: ${char}`);
      }
      total += value * POWERS_2[i];
    } else {
      if (char < '0' || char > '9') {
        throw new Error(`Invalid digit in container number: ${char}`);
      }
      total += Number(char) * POWERS_2[i];
    }
  }

  const check = total % 11;
  return check === 10 ? 0 : check;
}

/** True if the 11-char number's trailing check digit is correct. */
export function validateCheckDigit(containerNumber: string): boolean {
  const n = normalizeContainerNumber(containerNumber);
  if (n.length !== 11 || !FULL_RE.test(n)) return false;

  const provided = Number(n[10]);
  let expected: number;
  try {
    expected = calculateCheckDigit(n.slice(0, 10));
  } catch {
    return false;
  }
  return provided === expected;
}

/** Full validation with a Vietnamese error message (for UI warnings). */
export function validateContainerNumber(containerNumber: string): [boolean, string] {
  if (!containerNumber) return [false, 'Vui lòng nhập số container'];

  const n = normalizeContainerNumber(containerNumber);
  if (!validateContainerFormat(n)) {
    return [false, 'Sai định dạng. Đúng: XXXXNNNNNNN (4 chữ cái + 7 số, vd: MSKU1234567)'];
  }
  if (!validateCheckDigit(n)) {
    return [false, 'Sai số kiểm tra — định dạng đúng nhưng mã kiểm tra không khớp'];
  }
  return [true, ''];
}

/** Lexicographic comparison of two score tuples (lower = better). */
function compareScore(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Suggest valid container numbers within 1–2 digit edits of `containerNumber`.
 *
 * Use case: driver enters / OCR reads a number whose ISO 6346 check digit does
 * not match. Most often this is a single-digit typo or OCR misread in the
 * 7-digit numeric portion.
 *
 * Rules:
 *   1. Keep the 4-letter owner code fixed (it identifies the container).
 *   2. Differ from the input in 1 or 2 of the 7 digit positions (4..10),
 *      which includes the check digit.
 *   3. Have a valid ISO 6346 check digit.
 *
 * Ranking (best first):
 *   - Fewer edits beat more edits.
 *   - Within the same edit count, prefer a check-digit-only edit.
 *   - Smaller absolute digit deltas next.
 *
 * Returns up to `maxResults` candidates, best-first. Never includes the input.
 * Returns [] if the input is already valid or its format is unrecoverable.
 */
export function suggestCorrections(containerNumber: string, maxResults = 3): string[] {
  if (maxResults <= 0) return [];

  const n = normalizeContainerNumber(containerNumber);
  if (!validateContainerFormat(n)) return [];
  if (validateCheckDigit(n)) return []; // already valid — nothing to suggest

  const owner = n.slice(0, 4);
  const originalDigits = n.slice(4, 11); // 7 digits: 6 serial + 1 check

  const scored = new Map<string, number[]>();

  const consider = (candidateDigits: string, editedPositions: number[]): void => {
    const candidate = owner + candidateDigits;
    if (candidate === n) return;
    if (!validateCheckDigit(candidate)) return;

    const editCount = editedPositions.length;
    // Bonus when the only edit is the check digit (position 6 of the 7-digit slice).
    const checkDigitOnly = editedPositions.length === 1 && editedPositions[0] === 6 ? 1 : 0;
    let deltaSum = 0;
    for (const p of editedPositions) {
      deltaSum += Math.abs(Number(candidateDigits[p]) - Number(originalDigits[p]));
    }
    const score: number[] = [editCount, 1 - checkDigitOnly, deltaSum];

    const existing = scored.get(candidate);
    if (!existing || compareScore(score, existing) < 0) {
      scored.set(candidate, score);
    }
  };

  // Pass 1: single-digit substitutions.
  for (let pos = 0; pos < 7; pos++) {
    const original = originalDigits[pos];
    for (const newDigit of '0123456789') {
      if (newDigit === original) continue;
      const candidateDigits = originalDigits.slice(0, pos) + newDigit + originalDigits.slice(pos + 1);
      consider(candidateDigits, [pos]);
    }
  }

  // Pass 2: two-digit substitutions — only if single-edit candidates are scarce.
  const singleEditCount = [...scored.values()].filter(s => s[0] === 1).length;
  if (singleEditCount < maxResults) {
    for (let posA = 0; posA < 7; posA++) {
      for (let posB = posA + 1; posB < 7; posB++) {
        const origA = originalDigits[posA];
        const origB = originalDigits[posB];
        for (const da of '0123456789') {
          if (da === origA) continue;
          for (const db of '0123456789') {
            if (db === origB) continue;
            const candidateDigits =
              originalDigits.slice(0, posA) +
              da +
              originalDigits.slice(posA + 1, posB) +
              db +
              originalDigits.slice(posB + 1);
            consider(candidateDigits, [posA, posB]);
          }
        }
      }
    }
  }

  const ranked = [...scored.entries()].sort((a, b) => compareScore(a[1], b[1]));
  return ranked.slice(0, maxResults).map(([candidate]) => candidate);
}
