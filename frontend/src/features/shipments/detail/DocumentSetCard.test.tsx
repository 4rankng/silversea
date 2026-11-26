/**
 * SIL-1073 (K3.104, Layer 2) — the review page's original-document-set card.
 * Pins: the 3-state KB chip (Còn thiếu · Đang bổ sung · Đã đủ), the receiver
 * + actual-received-date facts, the missing-document names, and the write
 * gate — 'Đã đủ' without Người nhận + Ngày nhận thực tế is refused client-
 * side with the KB reason and never reaches the API.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShipmentDocumentSetStatus, type ShipmentDocumentSet } from '@tingting/shared';

const { updateShipmentDocumentSet } = vi.hoisted(() => ({ updateShipmentDocumentSet: vi.fn() }));

vi.mock('../../../api/shipmentClient', () => ({
  updateShipmentDocumentSet,
}));

import { DocumentSetCard } from './DocumentSetCard';

function makeSet(overrides: Partial<ShipmentDocumentSet> = {}): ShipmentDocumentSet {
  return {
    status: ShipmentDocumentSetStatus.MISSING,
    label: 'Còn thiếu',
    missingDocuments: [],
    receiverName: null,
    receivedOn: null,
    changedAt: null,
    changedByName: null,
    editable: false,
    ...overrides,
  };
}

function renderCard(props: { documentSetOverrides?: Partial<ShipmentDocumentSet> } = {}) {
  const onSaved = vi.fn();
  return {
    onSaved,
    ...render(
      <DocumentSetCard
        shipmentId={1301}
        version={12}
        documentSet={makeSet(props.documentSetOverrides)}
        onSaved={onSaved}
      />,
    ),
  };
}

beforeEach(() => {
  updateShipmentDocumentSet.mockReset();
});

describe('SIL-1073 — Bộ hồ sơ chứng từ gốc (Lớp 2)', () => {
  it('a lot with no fact reads "Còn thiếu" (the KB default) with the receiver facts empty', () => {
    renderCard();
    expect(screen.getByText('Bộ hồ sơ chứng từ gốc')).toBeTruthy();
    expect(screen.getByText('Còn thiếu')).toBeTruthy();
    expect(screen.getByText('Người nhận').closest('div')!.textContent).toContain('—');
    expect(screen.getByText('Ngày nhận thực tế').closest('div')!.textContent).toContain('—');
  });

  it('a complete set names the receiver, the actual received date (dd/mm/yyyy), and the missing docs', () => {
    renderCard({
      documentSetOverrides: {
        status: ShipmentDocumentSetStatus.COMPLETE,
        label: 'Đã đủ',
        receiverName: 'chị Lan',
        receivedOn: '2026-11-25',
        missingDocuments: [],
      },
    });
    expect(screen.getByText('Đã đủ')).toBeTruthy();
    expect(screen.getByText('chị Lan')).toBeTruthy();
    expect(screen.getByText('25/11/2026')).toBeTruthy();
    expect(screen.queryByText('Tài liệu còn thiếu')).toBeNull();
  });

  it('missing-document names render as the debt list the "Nợ chứng từ" screen carries', () => {
    renderCard({
      documentSetOverrides: {
        status: ShipmentDocumentSetStatus.SUPPLEMENTING,
        label: 'Đang bổ sung',
        missingDocuments: ['Biên bản giao nhận (bản gốc)', 'Phiếu hạ bãi'],
      },
    });
    expect(screen.getByText('Đang bổ sung')).toBeTruthy();
    expect(screen.getByText('Biên bản giao nhận (bản gốc)')).toBeTruthy();
    expect(screen.getByText('Phiếu hạ bãi')).toBeTruthy();
  });

  it('a read-only viewer (editable false) renders no editor', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: 'Lưu bộ hồ sơ' })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Trạng thái bộ hồ sơ' })).toBeNull();
  });

  it('the editor gates "Đã đủ" without Người nhận + Ngày nhận thực tế — the KB reason, no API call', () => {
    updateShipmentDocumentSet.mockResolvedValue({ shipmentVersion: 13 });
    renderCard({ documentSetOverrides: { editable: true } });
    const complete = screen.getByRole('radio', { name: 'Đã đủ' });
    fireEvent.click(complete);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bộ hồ sơ' }));
    expect(screen.getByRole('alert').textContent).toContain('Người nhận và Ngày nhận thực tế');
    expect(updateShipmentDocumentSet).not.toHaveBeenCalled();
  });

  it('a valid "Đã đủ" save posts the versioned payload and refreshes the host', async () => {
    updateShipmentDocumentSet.mockResolvedValue({ shipmentVersion: 13 });
    const { onSaved } = renderCard({ documentSetOverrides: { editable: true } });
    fireEvent.click(screen.getByRole('radio', { name: 'Đã đủ' }));
    fireEvent.change(screen.getByPlaceholderText('Người nhận bộ hồ sơ gốc'), { target: { value: 'chị Lan' } });
    const dateInput = screen.getByLabelText('Ngày nhận thực tế') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2026-11-25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bộ hồ sơ' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(updateShipmentDocumentSet).toHaveBeenCalledWith(1301, expect.objectContaining({
      expectedShipmentVersion: 12,
      status: ShipmentDocumentSetStatus.COMPLETE,
      receiverName: 'chị Lan',
      receivedOn: '2026-11-25',
    }));
  });

  it('a server rejection lands in the card verbatim (the BE reason is the authority)', async () => {
    updateShipmentDocumentSet.mockRejectedValue(new Error('Lô hàng vừa thay đổi. Vui lòng tải lại trước khi cập nhật bộ hồ sơ.'));
    renderCard({ documentSetOverrides: { editable: true } });
    fireEvent.click(screen.getByRole('radio', { name: 'Đang bổ sung' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lưu bộ hồ sơ' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Lô hàng vừa thay đổi'));
    expect(screen.queryByRole('button', { name: 'Đang lưu…' })).toBeNull();
  });
});
