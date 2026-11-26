// K2.23 (SIL-1084) — sửa ô Cước thu lệch so với giá engine/hợp đồng phải
// ghi lý do (KB §5.2.8: "Giá cuối khác giá hợp đồng thì phải có lý do có
// nội dung"; §5.4.5: "bắt buộc nhập lý do có nội dung + ghi lịch sử thay
// đổi"). Three seams, no db / app boot (BE unit-only law):
//   1. the route schema accepts the reason and refuses a blank/oversized one
//      (the FE dialog is the first gate, the schema is the second);
//   2. the DEBIT_RATE_OVERRIDE_SET audit payload stores the reason verbatim
//      (source-scan — the write path needs a live transaction);
//   3. the board wire carries the PRE-override engine/contract anchor
//      (cuocThuAuto + cuocThuAutoFormula) so kế toán đối chiếu beside the
//      input and the FE dialog compares against the engine channel.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rateOverrideSchema } from '../../routes/accounting-debit';

const here = dirname(fileURLToPath(import.meta.url));
const routeSource = readFileSync(join(here, '../../routes/accounting-debit.ts'), 'utf8');
const serviceSource = readFileSync(join(here, '../../services/accounting-debit-close.service.ts'), 'utf8');

describe('SIL-1084 — rateOverrideSchema carries the override reason', () => {
  it('accepts a reason and trims it', () => {
    const parsed = rateOverrideSchema.safeParse({ shipmentId: 1, rates: { cuocThu: 4100000 }, reason: '  đàm phán lại giá cuối với chủ hàng  ' });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.reason, 'đàm phán lại giá cuối với chủ hàng');
  });

  it('reason stays optional — every existing caller replays unchanged', () => {
    const parsed = rateOverrideSchema.safeParse({ shipmentId: 1, rates: { cuocThu: 4100000 } });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.reason, undefined);
  });

  it('refuses a blank reason — trim leaves nothing (lý do phải có nội dung)', () => {
    const parsed = rateOverrideSchema.safeParse({ shipmentId: 1, rates: { cuocThu: 4100000 }, reason: '   ' });
    assert.equal(parsed.success, false);
  });

  it('refuses a reason over 500 chars', () => {
    const parsed = rateOverrideSchema.safeParse({ shipmentId: 1, rates: { cuocThu: 4100000 }, reason: 'x'.repeat(501) });
    assert.equal(parsed.success, false);
  });
});

describe('SIL-1084 — the write path and the board wire carry the reason/anchor', () => {
  it('the handler forwards the parsed body (reason included) into the service', () => {
    assert.match(
      routeSource,
      /setShipmentDebitRateOverrides\(\{ \.\.\.parsed\.data, userId: user\.userId \}\)/,
      'the rates handler must spread parsed.data so reason reaches the service',
    );
  });

  it('the DEBIT_RATE_OVERRIDE_SET audit payload stores the reason', () => {
    assert.match(
      serviceSource,
      /message: 'DEBIT_RATE_OVERRIDE_SET',[\s\S]{0,400}?payload: \{ containerId, before, after, changedFields, reason: input\.reason \?\? null \},/,
      'the audit payload must record reason beside before/after',
    );
  });

  it('the service input type names the optional reason', () => {
    assert.match(serviceSource, /reason\?: string;/);
  });

  it('the board row wires cuocThuAuto + cuocThuAutoFormula from the derived channel', () => {
    assert.match(serviceSource, /cuocThuAuto: derivedCells\.cuocThu,/);
    assert.match(serviceSource, /cuocThuAutoFormula: freightAutoFormulaByLot\.get\(lot\.id\) \?\? null,/);
    // The formula follows the SAME snapshot channel the engine value reads.
    assert.match(serviceSource, /freightAutoFormulaByLot\.set\(lot\.id, snapshotChannel\?\.formulaNote \?\? null\)/);
  });
});
