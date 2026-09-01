// Pure payment-session helpers for the debt detail surface.
// Split from pages/DebtDetailPage.tsx in the 2026-09-01 structural wave (move-only).
import type { PaymentReceiptResult } from '@tingting/shared';
import { formatCurrency } from '../../lib/format';

export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function nextPaymentRequestKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `payment-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function paymentDraftFingerprint(amount: string, receiptId: string): string {
  return JSON.stringify({
    amount: amount.trim().replace(/[.,\s]/g, ''),
    receiptId: receiptId.trim(),
  });
}

export function paymentResultMessage(result: PaymentReceiptResult, replayed: boolean): string {
  const allocated = formatCurrency(result.allocatedTotal);
  const unapplied = formatCurrency(result.unappliedAmount);
  const targetCount = result.allocations.length;
  if (result.unappliedAmount > 0) {
    return replayed
      ? `Phiếu thu ${result.receiptId} đã được ghi nhận trước đó: phân bổ ${allocated} vào ${targetCount} khoản nợ, còn ${unapplied} chưa phân bổ.`
      : `Đã ghi nhận phiếu thu ${result.receiptId}: phân bổ ${allocated} vào ${targetCount} khoản nợ, còn ${unapplied} chưa phân bổ.`;
  }
  return replayed
    ? `Phiếu thu ${result.receiptId} đã được ghi nhận trước đó và phân bổ ${allocated} vào ${targetCount} khoản nợ.`
    : `Đã ghi nhận phiếu thu ${result.receiptId} và phân bổ ${allocated} vào ${targetCount} khoản nợ.`;
}

