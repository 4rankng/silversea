import { z } from 'zod';

const amount = z.number().int('Số tiền phải là VND nguyên.').min(0).max(999_999_999_999_999);
const positiveAmount = amount.refine((value) => value > 0, 'Số tiền phải lớn hơn 0.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ.').refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Ngày không tồn tại.');
const note = z.string().trim().max(2_000).nullable().optional();
const recordIdentity = {
  id: z.number().int().positive().optional(),
  expectedVersion: z.number().int().nonnegative(),
};

export const shipmentInvoiceRecordSchema = z.object({
  ...recordIdentity,
  supplierId: z.number().int().positive(),
  invoiceNumber: z.string().trim().min(1, 'Nhập số hóa đơn.').max(100),
  invoiceDate: date,
  faceAmount: positiveAmount,
  supplierFeeAmount: positiveAmount,
  sourceExpenseId: z.number().int().positive().nullable().optional(),
  note,
}).strict().refine((value) => value.id ? value.expectedVersion > 0 : value.expectedVersion === 0, {
  path: ['expectedVersion'], message: 'Phiên bản hồ sơ không hợp lệ.',
});

export const containerDepositSchema = z.object({
  ...recordIdentity,
  billNumber: z.string().trim().min(1, 'Nhập số Bill.').max(100),
  shippingLineName: z.string().trim().min(1, 'Nhập hãng tàu.').max(255),
  amount: positiveAmount,
  depositDate: date,
  documentsSubmittedDate: date.nullable().optional(),
  refundReceivedDate: date.nullable().optional(),
  recoveredAmount: amount,
  note,
}).strict().superRefine((value, context) => {
  if (value.id ? value.expectedVersion <= 0 : value.expectedVersion !== 0) {
    context.addIssue({ code: 'custom', path: ['expectedVersion'], message: 'Phiên bản hồ sơ không hợp lệ.' });
  }
  if (value.recoveredAmount > value.amount) {
    context.addIssue({ code: 'custom', path: ['recoveredAmount'], message: 'Tiền hoàn không được vượt tiền cược.' });
  }
  if (value.recoveredAmount > 0 && !value.refundReceivedDate) {
    context.addIssue({ code: 'custom', path: ['refundReceivedDate'], message: 'Nhập ngày nhận tiền hoàn.' });
  }
  if (value.refundReceivedDate && value.recoveredAmount === 0) {
    context.addIssue({ code: 'custom', path: ['recoveredAmount'], message: 'Nhập số tiền đã nhận hoàn.' });
  }
});

export type ShipmentInvoiceRecordInput = z.infer<typeof shipmentInvoiceRecordSchema>;
export type ContainerDepositInput = z.infer<typeof containerDepositSchema>;
