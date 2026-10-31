/**
 * SIL-638 (id 742) TC7 — Hàng Kết hợp (COMBINED) pairing rules.
 *
 * DOC logic-hang-kep-kethop (owner-standard):
 * (1) mismatched container sizes never pair — HARD block, verbatim text
 *     "Hàng kết hợp yêu cầu 2 lệnh phải có cùng kích cỡ container (cùng 20'
 *     hoặc cùng 40')" — note 40'+40' IS allowed (unlike kẹp);
 * (2) when the pair forms and Lệnh 2's số container is blank, it inherits
 *     Lệnh 1's shell number;
 * (3) VETC booked once for the pair (law pinned in the TC3 file; the
 *     pairing flow applies the same dedup to KET_HOP).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  backhaulTollDeductionForSecond,
  combinedContainerSizeBlockMessage,
  COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE,
  containerNumberToInherit,
} from '../../services/trip-pair-rules.service';

describe('SIL-638 TC7(1) — kết hợp requires the same container size', () => {
  it('the block message is the DOC verbatim text', () => {
    assert.equal(COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE, "Hàng kết hợp yêu cầu 2 lệnh phải có cùng kích cỡ container (cùng 20' hoặc cùng 40')");
  });

  it('same sizes pair — including 40′ + 40′ (the kẹp difference)', () => {
    assert.equal(combinedContainerSizeBlockMessage('20DV', '20RF'), null);
    assert.equal(combinedContainerSizeBlockMessage('40HC', '40HC'), null);
  });

  it('a proven mismatch blocks with the DOC text', () => {
    assert.equal(combinedContainerSizeBlockMessage('20DV', '40HC'), COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE);
    assert.equal(combinedContainerSizeBlockMessage('40HC', '20GP'), COMBINED_CONTAINER_SIZE_BLOCK_MESSAGE);
  });

  it('an unknown size cannot prove a mismatch — same "bổ sung sau" convention as the number rule', () => {
    assert.equal(combinedContainerSizeBlockMessage(null, '40HC'), null);
    assert.equal(combinedContainerSizeBlockMessage('20DV', ''), null);
  });
});

describe('SIL-638 TC7(2) — Lệnh 2 inherits Lệnh 1’s số container when blank', () => {
  it('blank Lệnh 2 takes Lệnh 1’s shell number', () => {
    assert.equal(containerNumberToInherit('MSCU1234567', null), 'MSCU1234567');
    assert.equal(containerNumberToInherit('MSCU1234567', ''), 'MSCU1234567');
    assert.equal(containerNumberToInherit('MSCU1234567', '   '), 'MSCU1234567');
  });

  it('a number already present is never overwritten', () => {
    assert.equal(containerNumberToInherit('MSCU1234567', 'MSCU7654321'), null);
    assert.equal(containerNumberToInherit('MSCU1234567', 'MSCU1234567'), null);
  });

  it('no source number → nothing to inherit', () => {
    assert.equal(containerNumberToInherit(null, ''), null);
    assert.equal(containerNumberToInherit('', null), null);
  });

  it('the inherited value is trimmed', () => {
    assert.equal(containerNumberToInherit('  MSCU1234567  ', null), 'MSCU1234567');
  });
});

describe('SIL-638 TC7(3) — VETC once for a COMBINED pair', () => {
  it('the same single-booking dedup rides the KET_HOP pair', () => {
    const delta = backhaulTollDeductionForSecond({
      tollsStations: 2,
      tollPerStationApplied: '55000',
      tollDeduction: '0',
      tollCost: '110000',
      reconciledTollCost: null,
    });
    assert.equal(delta.tollDeduction, '110000');
    assert.equal(delta.tollCost, '0');
  });
});
