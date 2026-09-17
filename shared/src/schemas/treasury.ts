import { z } from 'zod';

export const treasuryFundCodeSchema = z.enum(['COMPANY', 'TM']);
export type TreasuryFundCode = z.infer<typeof treasuryFundCodeSchema>;

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
