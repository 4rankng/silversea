/**
 * SIL-162 component pins for /demo/driver-app (TC-SIL162-01/03/04): phone
 * mockup + driver picker, layer-1 card content, the OCR demo flow (badge
 * "Đang đọc dữ liệu..." → auto-fill sau 1,2s, sửa tay được) and the sticky
 * complete action flipping the card to its completed state.
 *
 * House pattern: fireEvent (repo không dùng @testing-library/user-event).
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DemoDriverAppPage from './DemoDriverAppPage';

function card(tripId: string) {
  return screen.getByTestId(`driver-trip-card-${tripId}`);
}

/** Đổi tài xế qua UuiSelectField: mở listbox rồi chọn option (house pattern). */
function pickDriver(value: string) {
  fireEvent.click(screen.getByRole('button', { name: /Xem theo tài xế/ }));
  fireEvent.click(screen.getByRole('option', { name: driverOptionName[value] }));
}

const driverOptionName: Record<string, string> = {
  'DRV-01': 'Nguyễn Văn Tâm — 51C-138.65',
  'DRV-02': 'Lê Minh Tuấn — 51C-469.80',
  'DRV-03': 'Trần Văn Hậu — 60C-229.15',
  'DRV-04': 'Phạm Quốc Dũng — 72L-846.30',
  'DRV-05': 'Võ Thành Lộc — 73K-517.94',
  'DRV-06': 'Đặng Văn Bảy — 50H-362.58',
};

describe('DemoDriverAppPage (SIL-162)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renders the 390×844 phone frame on a gray stage with the default driver (TC-SIL162-01)', () => {
    render(<DemoDriverAppPage />);

    const frame = screen.getByTestId('demo-phone-frame');
    expect(frame).toHaveStyle({ width: '390px', height: '844px' });
    expect(screen.getByTestId('demo-phone-stage')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Ứng dụng Lái Xe' })).toBeInTheDocument();

    // Default DRV-01 (Nguyễn Văn Tâm) — 2 thẻ lệnh trong ngày demo.
    expect(screen.getByTestId('driver-phone-header-name')).toHaveTextContent('Nguyễn Văn Tâm');
    expect(screen.getByTestId('driver-trip-list')).toHaveTextContent('2 chuyến');
    expect(screen.getByTestId('driver-trip-card-T-2401')).toBeInTheDocument();
    expect(screen.getByTestId('driver-trip-card-T-2402')).toBeInTheDocument();
    expect(screen.queryByTestId('driver-trip-card-T-2403')).not.toBeInTheDocument();
  });

  it('switching the demo driver swaps the trip list — DRV-02 shows the twin-lift pair (TC-SIL162-01/02)', () => {
    render(<DemoDriverAppPage />);
    pickDriver('DRV-02');

    expect(screen.getByTestId('driver-phone-header-name')).toHaveTextContent('Lê Minh Tuấn');
    expect(screen.getByTestId('driver-trip-list')).toHaveTextContent('3 chuyến');
    // Badge CHẠY KẸP purple pill chỉ ở 2 vỏ kẹp đôi.
    expect(within(card('T-2403')).getByText('CHẠY KẸP')).toBeInTheDocument();
    expect(within(card('T-2404')).getByText('CHẠY KẸP')).toBeInTheDocument();
    expect(within(card('T-2405')).queryByText('CHẠY KẸP')).not.toBeInTheDocument();
  });

  it('layer-1 card shows time, route chips, size/flow, red warning and finance lines (TC-SIL162-02)', () => {
    render(<DemoDriverAppPage />);

    const t2401 = card('T-2401');
    expect(within(t2401).getByText('05:30')).toBeInTheDocument();
    expect(within(t2401).getAllByText('Cát Lái').length).toBeGreaterThanOrEqual(2);
    expect(within(t2401).getByText('Samsung SEHC')).toBeInTheDocument();
    expect(within(t2401).getByText('40′')).toBeInTheDocument();
    expect(within(t2401).getByText('Hàng Xuất')).toBeInTheDocument();
    expect(within(t2401).getByText('Công ty đã UNC — vào lấy lệnh')).toBeInTheDocument();
    expect(within(t2401).queryByText(/Chờ kế toán/)).not.toBeInTheDocument();

    const t2402 = card('T-2402');
    expect(within(t2402).getByText('13:00')).toBeInTheDocument();
    expect(within(t2402).getByText('Hàng Nhập')).toBeInTheDocument();
    // Khung cảnh báo đỏ mang đúng ghi chú cảng của fixture.
    const warning = t2402.querySelector('.border-error_subtle');
    expect(warning).not.toBeNull();
    expect(warning).toHaveTextContent('Chờ CCP đỗ cổng số 3, cân vỏ trước khi vào kho.');
    expect(within(t2402).getByText(/Lái xe tự chi 1\.430\.000 ₫/)).toBeInTheDocument();
    expect(within(t2402).getByText(/HĐ về tên Công ty CP VICT/)).toBeInTheDocument();
  });

  it('tapping a card opens the detail; OCR shows the reading badge then auto-fills editable fields (TC-SIL162-03)', () => {
    render(<DemoDriverAppPage />);

    fireEvent.click(card('T-2401'));
    expect(screen.getByTestId('driver-trip-detail-T-2401')).toBeInTheDocument();
    expect(screen.getByText(/Booking MSKU7648291/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ocr-capture-button'));

    // Ngay khi bấm: thumbnail + badge "Đang đọc dữ liệu...".
    expect(screen.getByRole('status')).toHaveTextContent('Đang đọc dữ liệu...');
    expect(screen.getByLabelText('Ảnh cửa container')).toBeInTheDocument();
    expect(screen.getByLabelText('Số cont')).toHaveValue('');

    // Sau 1,2s: 4 ô tự điền từ fixture.
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByLabelText('Số cont')).toHaveValue('MSKU 7648291');
    expect(screen.getByLabelText('Số chì')).toHaveValue('SL-88124');
    expect(screen.getByLabelText('Max Gross (kg)')).toHaveValue('32500');
    expect(screen.getByLabelText('Tare (kg)')).toHaveValue('3900');

    // Sửa tay được sau khi OCR điền.
    fireEvent.change(screen.getByLabelText('Số chì'), { target: { value: 'SL-99999' } });
    expect(screen.getByLabelText('Số chì')).toHaveValue('SL-99999');
  });

  it('E-POD slots flip to attached when uploaded (TC-SIL162-03)', () => {
    render(<DemoDriverAppPage />);
    fireEvent.click(card('T-2402'));

    const slot = screen.getByTestId('doc-slot-eir-lift');
    expect(within(slot).getByText('Chưa tải lên')).toBeInTheDocument();
    fireEvent.click(within(slot).getByRole('button', { name: /Tải lên/ }));
    expect(within(slot).getByText('eir-nang-CH-2410-02.jpg')).toBeInTheDocument();
    expect(within(slot).getByText('Đã tải lên')).toBeInTheDocument();
  });

  it('completing a trip returns to the list with the card marked completed (TC-SIL162-04)', () => {
    render(<DemoDriverAppPage />);
    fireEvent.click(card('T-2402'));

    const complete = screen.getByTestId('complete-trip-button');
    expect(complete).toHaveTextContent('Hoàn thành chuyến');
    fireEvent.click(complete);

    // Về Layer 1 — thẻ còn trong danh sách, mờ + badge Đã hoàn thành.
    expect(screen.queryByTestId('driver-trip-detail-T-2402')).not.toBeInTheDocument();
    const done = card('T-2402');
    expect(within(done).getByText('Đã hoàn thành')).toBeInTheDocument();
    expect(done.className).toContain('opacity-60');

    // Mở lại: trạng thái hoàn thành giữ nguyên, không còn nút hoàn thành.
    fireEvent.click(done);
    expect(screen.getByText('Chuyến đã hoàn thành')).toBeInTheDocument();
    expect(screen.queryByTestId('complete-trip-button')).not.toBeInTheDocument();
  });
});
