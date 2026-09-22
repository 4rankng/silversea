import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { assignPhoiPhieuTruckAccountant, confirmPhoiPhieuTienDuong, createPhoiPhieuVoucher, updatePhoiPhieuMeta, voidPhoiPhieuRow } from './phoiPhieuClient';
import { confirmRateAdjustments, sendRateAdjustmentRequests, withdrawRateAdjustments } from './accountingDebitClient';
import { createDepositTracker, updateDepositTrackerDates, markDepositRefunded } from './depositRefundClient';
const fetcher = vi.fn();
const commands = [
  ['voucher', () => createPhoiPhieuVoucher({ tripIds: [7], direction: 'IN', treasuryAccountId: 2 })],
  ['assignment', () => assignPhoiPhieuTruckAccountant(9, { accountantId: 3, expectedVersion: 1 })],
  ['metadata', () => updatePhoiPhieuMeta(7, { trangThaiLay: 'Received' })],
  ['void', () => voidPhoiPhieuRow(7, 15, 'Entered by mistake')],
  ['driver confirmation', () => confirmPhoiPhieuTienDuong(7, 1, 3)],
  ['rate request', () => sendRateAdjustmentRequests({ shipmentIds: [10] })],
  ['rate confirm', () => confirmRateAdjustments([12])],
  ['rate withdraw', () => withdrawRateAdjustments([13])],
  ['deposit create', () => createDepositTracker({ billNumber: 'QA', customerName: 'QA', carrierName: 'QA', depositAmount: 5000000 })],
  ['deposit dates', () => updateDepositTrackerDates(9, { depositAmount: 5000000, cvSubmittedDate: null })],
  ['deposit refund', () => markDepositRefunded(9, 5000000)],
] as const;
beforeEach(() => { vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); api.setToken('qa-retry-session'); });
afterEach(() => { api.clearToken(); vi.unstubAllGlobals(); });
describe('accounting command response-loss recovery', () => {
  for (const [name, command] of commands) {
    it(`${name} retains its generated key after a committed but truncated response`, async () => {
      fetcher.mockResolvedValueOnce(new Response('{', { status: 200 }))
        .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
      await expect(command()).rejects.toThrow();
      await command();
      const requests = fetcher.mock.calls.map(([url, init]) => ({ url, body: init.body, key: init.headers['Idempotency-Key'] }));
      expect(requests[0].key).toEqual(expect.any(String));
      expect(requests[1]).toEqual(requests[0]);
    });
  }
  it('preserves a caller-provided command identity', async () => {
    fetcher.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    await createPhoiPhieuVoucher({ tripIds: [7], direction: 'IN', treasuryAccountId: 2 }, 'caller-command');
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBe('caller-command');
  });
});
