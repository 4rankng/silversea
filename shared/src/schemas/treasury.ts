import { z } from 'zod';

export const treasuryFundCodeSchema = z.enum(['COMPANY', 'TM']);
export type TreasuryFundCode = z.infer<typeof treasuryFundCodeSchema>;

/** Card 2026-10-05_381 (REQ-5.10-13) — the ONE place an accountant's fund name is
 *  written. The customer's spec 5.10 names the sources "Quỹ tiền mặt" and "Quỹ
 *  công ty"; the system shipped the first as the abbreviation "Quỹ TM" and repeated
 *  that literal across five frontend surfaces and three backend messages, so the
 *  wording could not change without a sweep.
 *
 *  The CODES stay COMPANY / TM forever: treasury account rows and posted ledger
 *  movements are keyed by them, so this is a display rename only. Read every
 *  user-visible fund name through this map — never inline the string. */
export const TREASURY_FUND_LABELS: Record<TreasuryFundCode, string> = {
  COMPANY: 'Quỹ công ty',
  TM: 'Quỹ tiền mặt',
};

export function treasuryFundLabel(code: TreasuryFundCode): string {
  return TREASURY_FUND_LABELS[code];
}

export const treasuryAccountSetupSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(160),
  type: z.enum(['CASH', 'BANK']),
  // Older clients can still create unclassified accounts; cash expense forms
  // require the account to be explicitly assigned to a fund before use.
  fundCode: treasuryFundCodeSchema.nullable().optional(),
  bankName: z.string().trim().max(160).optional(),
  bankAccountNumber: z.string().trim().max(80).optional(),
  openingBalance: z.number().int().safe(),
  openingBalanceDate: z.string().date(),
  reason: z.string().trim().min(1).max(1000),
  openingBalanceEvidence: z.string().trim().min(1).max(255),
});
export const treasuryAccountFundSchema = z.object({
  fundCode: treasuryFundCodeSchema,
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(1000),
});
export type TreasuryAccountSetupInput = z.infer<typeof treasuryAccountSetupSchema>;
export type TreasuryAccountFundInput = z.infer<typeof treasuryAccountFundSchema>;
