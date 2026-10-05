import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvoiceTrackingRow } from '@tingting/shared';
const api = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), lots: vi.fn(), detail: vi.fn() }));
vi.mock('../../api/invoiceTrackingClient', () => ({ createInvoiceTracking: api.create, updateInvoiceTracking: api.update }));
vi.mock('../../api/shipmentClient', () => ({ listShipments: api.lots, getShipmentDetail: api.detail }));
import InvoiceTrackingFormModal from './InvoiceTrackingFormModal';

const row = { id: 7, invoiceNumber: 'QA-INV', invoiceAmount: '1200000', supplierPayment: '270000',
  expenseDate: '2026-09-22', progress: 'CHUA_GUI' } as InvoiceTrackingRow;
beforeEach(() => {
  vi.resetAllMocks();
  api.lots.mockResolvedValue({ items: [{ id: 9, shipmentCode: 'QA-LOT', blNumber: 'QA-WF04-114144', bookingRef: null, customerName: 'QA customer' }] });
  api.detail.mockResolvedValue({ podReviews: [{ tripId: 11, tripCode: 'QA-TRIP', tripStatus: 'COMPLETED' }] });
});

describe('invoice save lifecycle', () => {
  it('invalidates a pending search when the query is cleared below its minimum', async () => {
    let resolve!: (value: unknown) => void;
    api.lots.mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    render(<InvoiceTrackingFormModal mode="create" row={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Bill / Booking'), { target: { value: 'QA-WF04' } });
    fireEvent.change(screen.getByLabelText('Bill / Booking'), { target: { value: '' } });
    await act(async () => resolve({ items: [{ id: 9, shipmentCode: 'STALE-LOT', blNumber: 'BL-001', customerName: 'Old result' }] }));
    expect(screen.queryByRole('button', { name: /BL-001/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Đang tìm lô…')).not.toBeInTheDocument();
  });

  for (const staleOutcome of ['resolve', 'reject'] as const) {
    it(`ignores an old lot's detail ${staleOutcome} after another lot is selected`, async () => {
      let resolve!: (value: unknown) => void; let reject!: (reason: Error) => void;
      api.lots.mockResolvedValue({ items: [{ id: 9, shipmentCode: 'QA-LOT-A', blNumber: 'BL-001' }, { id: 10, shipmentCode: 'QA-LOT-B', bookingRef: 'BOOK-001' }] });
      api.detail.mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }))
        .mockResolvedValueOnce({ podReviews: [{ tripId: 12, tripCode: 'TRIP-B' }] });
      api.create.mockResolvedValue({});
      render(<InvoiceTrackingFormModal mode="create" row={null} onClose={vi.fn()} onSaved={vi.fn()} />);
      fireEvent.change(screen.getByLabelText('Bill / Booking'), { target: { value: 'BL-001' } });
      fireEvent.click(await screen.findByRole('button', { name: 'BL-001' }));
      fireEvent.change(screen.getByLabelText('Bill / Booking'), { target: { value: 'BOOK-001' } });
      fireEvent.click(await screen.findByRole('button', { name: 'BOOK-001' }));
      expect(await screen.findByLabelText('Chuyến (cont)')).toHaveTextContent('BOOK-001');
      await act(async () => {
        if (staleOutcome === 'resolve') resolve({ podReviews: [{ tripId: 11, tripCode: 'TRIP-A' }] });
        else reject(new Error('Old request failed'));
      });
      expect(screen.getByLabelText('Chuyến (cont)')).toHaveTextContent('BOOK-001');
      expect(screen.queryByText('TRIP-A')).not.toBeInTheDocument();
      expect(screen.queryByText('Không tải được danh sách chuyến của lô.')).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('Số hóa đơn'), { target: { value: 'QA-INV' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
      await waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 10, tripId: 12 }), expect.any(String)));
    });
  }

  for (const mode of ['create', 'edit'] as const) {
    it(`${mode}: one in-flight command; failed unchanged retry reuses key; changed retry gets a new key`, async () => {
      const write = mode === 'create' ? api.create : api.update;
      let reject!: (error: Error) => void;
      write.mockImplementationOnce(() => new Promise((_resolve, no) => { reject = no; }))
        .mockRejectedValueOnce(new Error('Retry failed')).mockResolvedValueOnce({});
      const onClose = vi.fn(); const onSaved = vi.fn();
      render(<InvoiceTrackingFormModal mode={mode} row={mode === 'edit' ? row : null} onClose={onClose} onSaved={onSaved} />);
      if (mode === 'create') {
        fireEvent.change(screen.getByLabelText('Bill / Booking'), { target: { value: 'QA-WF04' } });
        fireEvent.click(await screen.findByRole('button', { name: /QA-WF04-114144/ }));
        await screen.findByLabelText('Chuyến (cont)');
        fireEvent.change(screen.getByLabelText('Số hóa đơn'), { target: { value: 'QA-INV' } });
        fireEvent.change(screen.getByLabelText('Số tiền hóa đơn (₫)'), { target: { value: '1200000' } });
        fireEvent.change(screen.getByLabelText('Số tiền trả NCC (₫)'), { target: { value: '270000' } });
      }
      const save = screen.getByRole('button', { name: 'Lưu' });
      fireEvent.click(save); fireEvent.click(save);
      expect(write).toHaveBeenCalledTimes(1);
      expect(save).toBeDisabled();
      expect(screen.getByLabelText('Số tiền trả NCC (₫)')).toBeDisabled();
      fireEvent.keyDown(document, { key: 'Escape' });
      fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => reject(new Error('Lost response')));
      await screen.findByText('Lost response');
      expect(screen.getByLabelText('Số tiền trả NCC (₫)')).toHaveValue(270000);
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
      await screen.findByText('Retry failed');
      const keyIndex = mode === 'create' ? 1 : 2;
      expect(write.mock.calls[0][keyIndex]).toEqual(expect.any(String));
      expect(write.mock.calls[1][keyIndex]).toBe(write.mock.calls[0][keyIndex]);
      fireEvent.change(screen.getByLabelText('Số tiền trả NCC (₫)'), { target: { value: '280000' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(write.mock.calls[2][keyIndex]).not.toBe(write.mock.calls[1][keyIndex]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  }

  // Card 367 (already-compliant record, not a red-first pin): the save catch
  // already surfaces the API message for Error-shaped rejections — the shape
  // the api client throws (ApiError extends Error). Pinned so the surface can
  // never silently regress to generic copy.
  it('card 367: a 4xx save refusal surfaces the API reason verbatim', async () => {
    api.update.mockRejectedValueOnce(Object.assign(new Error('Số hóa đơn đã tồn tại trong hệ thống.'), { status: 409 }));
    render(<InvoiceTrackingFormModal mode="edit" row={row} onClose={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Lưu' }));
    expect(await screen.findByText('Số hóa đơn đã tồn tại trong hệ thống.')).toBeTruthy();
  });
});
