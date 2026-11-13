import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mergedContainerLabel, settlementLotIdentityTitle } from './settlement-identity';

describe('mergedContainerLabel (SIL-811 Số cont)', () => {
  test('one assigned container shows the bare number', () => {
    assert.equal(mergedContainerLabel(['MSKU1234565']), 'MSKU1234565');
  });

  test('Chung lô / tất cả cont rolls up as a counted list', () => {
    assert.equal(
      mergedContainerLabel(['MSKU1234570', 'MSKU1234565']),
      '2 cont: MSKU1234570, MSKU1234565',
    );
  });

  test('duplicates and blanks never skew the roll-call', () => {
    assert.equal(mergedContainerLabel(['MSKU1', ' MSKU1 ', '', 'MSKU2']), '2 cont: MSKU1, MSKU2');
    assert.equal(mergedContainerLabel([]), null);
    assert.equal(mergedContainerLabel(['', '  ']), null);
  });
});

describe('settlementLotIdentityTitle (SIL-811 dòng tiêu đề định danh)', () => {
  test('customer shorthand + Bill + tờ khai + merged conts in one line', () => {
    assert.equal(settlementLotIdentityTitle({
      customerName: 'LONGMINH',
      billRef: 'R8B-472',
      tradeDirection: 'IMPORT',
      declarationNumbers: ['10859073650'],
      containerNumbers: ['MSKU1234570', 'MSKU1234565'],
    }), 'LONGMINH · Bill: R8B-472 · TK: 10859073650 · 2 cont: MSKU1234570, MSKU1234565');
  });

  test('EXPORT reads Booking, and a single assigned cont shows its number', () => {
    assert.equal(settlementLotIdentityTitle({
      customerName: 'ASKEY',
      billRef: 'BK-9-2611',
      tradeDirection: 'EXPORT',
      declarationNumbers: ['10859073650'],
      containerNumbers: ['MSKU1234565'],
    }), 'ASKEY · Booking: BK-9-2611 · TK: 10859073650 · MSKU1234565');
  });

  test('missing bill keeps the established honest fallback, never a number', () => {
    assert.equal(settlementLotIdentityTitle({ customerName: 'YUANFANG', tradeDirection: 'IMPORT' }),
      'YUANFANG · Bill: Chưa có số Bill/Booking');
  });

  test('empty customer / tờ khai / cont segments drop out of the line', () => {
    assert.equal(settlementLotIdentityTitle({
      customerName: '  ',
      billRef: 'R8B-472',
      declarationNumbers: ['', '  '],
      containerNumbers: [],
    }), 'Bill: R8B-472');
  });

  test('tờ khai list dedupes and joins with the house comma convention', () => {
    assert.equal(settlementLotIdentityTitle({
      customerName: 'LONGMINH',
      billRef: 'R8B-472',
      declarationNumbers: ['10859073650', '10859073651', '10859073650'],
      containerNumbers: ['A', 'B'],
    }), 'LONGMINH · Bill: R8B-472 · TK: 10859073650, 10859073651 · 2 cont: A, B');
  });

  test("the dead 'Không rõ container' phrase never reaches a title", () => {
    const title = settlementLotIdentityTitle({ customerName: 'LONGMINH', billRef: 'R8B-472' });
    assert.ok(!title.includes('Không rõ container'));
  });
});
