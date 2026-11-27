// SIL-1080 (K2.13, KB §3.4.1/§5.5.2) — the SAVE is the declaration auto-copy,
// the same FB-109 behavior the drawer's inline declaration save runs: a lot
// assigned one số tờ khai copies it to every container still blank at save.
// Rows already holding their own number are never overwritten (the SIL-521
// same-lot divergence law).
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  buildShipmentContainerPayload,
  createEmptyContainer,
  type ShipmentContainerDraft,
} from './shipment-create-model';

const fclForm = { ...EMPTY_SHIPMENT_CREATE_FORM, cargoMode: 'FCL' as const };

/** A row that survives the payload filter (any real field set) and carries
 *  exactly the declaration under test. */
function row(declarationNumber: string, containerNumber: string): ShipmentContainerDraft {
  return { ...createEmptyContainer(), declarationNumber, containerNumber };
}

function payloadDeclarations(rows: ShipmentContainerDraft[]) {
  return buildShipmentContainerPayload(fclForm, rows).map((item) => item.declarationNumber);
}

describe('SIL-1080 — save-time declaration auto-copy (payload)', () => {
  it('blank containers receive the lot first số tờ khai at save', () => {
    expect(payloadDeclarations([
      row('TK-2CONT-01', 'CONT-1'),
      row('', 'CONT-2'),
      row('', 'CONT-3'),
    ])).toEqual(['TK-2CONT-01', 'TK-2CONT-01', 'TK-2CONT-01']);
  });

  it('a container with its own number is never overwritten', () => {
    expect(payloadDeclarations([
      row('TK-CHINH-01', 'CONT-1'),
      row('TK-RIENG-02', 'CONT-2'),
      row('', 'CONT-3'),
    ])).toEqual(['TK-CHINH-01', 'TK-RIENG-02', 'TK-CHINH-01']);
  });

  it('the first non-empty row wins even when it is not row 1', () => {
    expect(payloadDeclarations([
      row('', 'CONT-1'),
      row('TK-SAUCUNG', 'CONT-2'),
    ])).toEqual(['TK-SAUCUNG', 'TK-SAUCUNG']);
  });

  it('an all-blank lot stays null everywhere (no invented numbers)', () => {
    expect(payloadDeclarations([
      row('', 'CONT-1'),
      row('', 'CONT-2'),
    ])).toEqual([null, null]);
  });
});
