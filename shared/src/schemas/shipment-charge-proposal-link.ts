import { z } from 'zod';

export const shipmentChargeProposalFieldSchema = z.enum([
  'OUTBOUND_TRANSPORT',
  'OUTBOUND_HANDLING',
  'OUTBOUND_INCIDENTAL',
  'INBOUND_TRANSPORT',
  'INBOUND_HANDLING',
]);

const shipmentChargeProposalReviewCommonShape = {
  expectedShipmentVersion: z.coerce.number().int().positive(),
  proposalFactId: z.coerce.number().int().positive('Đề xuất phí là bắt buộc'),
  proposalField: shipmentChargeProposalFieldSchema,
  proposalVersion: z.coerce.number().int().positive('Phiên bản đề xuất không hợp lệ'),
  reason: z.string().trim().min(1, 'Lý do xử lý là bắt buộc').max(2000),
};

export const shipmentChargeProposalReviewSchema = z.discriminatedUnion('decision', [
  z.object({
    ...shipmentChargeProposalReviewCommonShape,
    decision: z.literal('ACCEPT_LINK'),
    billingDocumentId: z.coerce.number().int().positive('Debit Note là bắt buộc'),
    billingDocumentLineId: z.coerce.number().int().positive('Dòng Debit Note là bắt buộc'),
  }).strict(),
  z.object({
    ...shipmentChargeProposalReviewCommonShape,
    decision: z.literal('REJECT'),
  }).strict(),
]);

export type ShipmentChargeProposalField = z.infer<typeof shipmentChargeProposalFieldSchema>;
export type ShipmentChargeProposalReviewInput = z.infer<typeof shipmentChargeProposalReviewSchema>;
