import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import { DispatchClassificationField } from './DispatchClassificationField';

const row = (cargoMode: 'FCL' | 'LCL' = 'FCL'): DispatchDetailPlanRow =>
  ({
    fulfillmentId: 101,
    cargoMode,
    classification: 'SINGLE',
  }) as DispatchDetailPlanRow;

/**
 * Card B 18/10 (B.3) — the customer re-reported "chọn Lấy Lẻ tự nhảy sang
 * tác vụ ĐẢO VỎ". The auto-seed was removed by the owner-acked card
 * 20261005_362 (commit 390dc945); this pin keeps the contract at the field
 * level so the flip can never quietly return: choosing Lấy Lẻ must hand the
 * note back BYTE-IDENTICAL (no ĐẢO VỎ segment composed), and the
 * classification's own label stays "Lấy Lẻ" — the run keeps its own task
 * label instead of borrowing the shell tag.
 */
describe('DispatchClassificationField — Lấy Lẻ never seeds ĐẢO VỎ (card 20261005_362, B.3)', () => {
  it('choosing Lấy Lẻ passes the note through untouched', () => {
    const onChange = vi.fn();
    render(
      <DispatchClassificationField
        row={row()}
        classification="SINGLE"
        operationalNotes="họp chị An 8h"
        onChange={onChange}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Phân loại/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Lấy Lẻ' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('LCL_PICKUP', 'họp chị An 8h');
    const [, note] = onChange.mock.calls[0]! as [string, string | null];
    expect(note ?? '').not.toContain('ĐẢO VỎ');
  });

  it('a note-less row stays note-less — no shell tag appears', () => {
    const onChange = vi.fn();
    render(
      <DispatchClassificationField
        row={row()}
        classification="SINGLE"
        operationalNotes={null}
        onChange={onChange}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Phân loại/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Lấy Lẻ' }));
    expect(onChange).toHaveBeenCalledWith('LCL_PICKUP', null);
  });

  it('Lấy Lẻ keeps its own classification label — never rendered as ĐẢO VỎ', () => {
    expect(DISPATCH_CLASSIFICATION_LABELS.LCL_PICKUP).toBe('Lấy Lẻ');
    expect(Object.values(DISPATCH_CLASSIFICATION_LABELS)).not.toContain('ĐẢO VỎ');
  });
});
