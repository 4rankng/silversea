/**
 * SIL-160 UI: the /demo/billing tabs render the AR/AP sheets from fixtures,
 * the kỳ filter empties the board, CSV export really downloads, and the AP
 * cấn trừ rows carry the amber highlight + formula tooltip.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DemoBillingPage from './DemoBillingPage';

describe('demo billing page (SIL-160)', () => {
  let clickedAnchors: HTMLAnchorElement[];

  beforeEach(() => {
    clickedAnchors = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function mockClick(this: HTMLAnchorElement) {
      clickedAnchors.push(this);
    });
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders tab 3.1 with the Samsung AR sheet and sticky totals', async () => {
    render(<DemoBillingPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Đối Soát & Công Nợ' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /3\.1/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { level: 2, name: 'Bảng kê phải thu — Samsung Electronics HCM CE, Tháng 10/2026' })).toBeInTheDocument();

    const table = screen.getByTestId('billing-ar-table');
    expect(table).toHaveTextContent('MSKU3091775');
    expect(table).toHaveTextContent('OOLU 6103307');
    // Sam các chuyến chưa có Số Bill — không có dòng phụ Bill nào.
    expect(table).not.toHaveTextContent('Bill ');
    expect(screen.getByTestId('billing-ar-total')).toHaveTextContent('14.100.000');
  });

  it('recomputes the sheet when the kỳ đối soát changes and shows the empty state', () => {
    render(<DemoBillingPage />);

    const monthInput = screen.getByLabelText('Kỳ đối soát');
    fireEvent.change(monthInput, { target: { value: '2026-11' } });

    expect(screen.getByTestId('billing-ar-total')).toHaveTextContent('0');
    expect(screen.getByText('Không có chuyến nào của khách hàng này trong kỳ đối soát.')).toBeInTheDocument();
  });

  it('recomputes the sheet when another khách hàng is selected', async () => {
    render(<DemoBillingPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Khách hàng/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: /Intel Việt Nam/ }));
    });

    expect(screen.getByTestId('billing-ar-total')).toHaveTextContent('7.200.000');
    const table = screen.getByTestId('billing-ar-table');
    expect(table).toHaveTextContent('HLCUVN7712043');
    // Chuyến nhập Intel có Số Bill — dòng phụ dưới booking.
    expect(table).toHaveTextContent('Bill HLCU7712043');
  });

  it('downloads a real CSV of the filtered sheet from the export button', () => {
    render(<DemoBillingPage />);

    fireEvent.click(screen.getByTestId('billing-csv-button'));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickedAnchors).toHaveLength(1);
    expect(clickedAnchors[0].download).toBe('bang-ke-phai-thu_SAM_2026-10.csv');
    expect(clickedAnchors[0].href).toBe('blob:mock-url');
  });

  it('renders tab 3.2 with the vendor AP sheet, cấn trừ amber rows and totals', async () => {
    render(<DemoBillingPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /3\.2/ }));
    });

    const rows = screen.getAllByTestId('billing-ap-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-deduction', 'true');
    expect(rows[0]).toHaveClass('bg-amber-50!');
    expect(rows[0]).toHaveTextContent('CH-2410-14');
    expect(rows[0]).toHaveTextContent('4.000.000'); // UNC chi hộ riêng
    expect(rows[0]).toHaveTextContent('500.000'); // thực trả = 4.500.000 − 4.000.000
    expect(rows[1]).toHaveAttribute('data-deduction', 'true');

    expect(screen.getByTestId('billing-ap-total-freight')).toHaveTextContent('8.100.000');
    expect(screen.getByTestId('billing-ap-total-unc')).toHaveTextContent('5.250.000');
    expect(screen.getByTestId('billing-ap-total-net')).toHaveTextContent('2.850.000');
  });

  it('exposes the bù trừ formula accessibly on deduction rows', async () => {
    render(<DemoBillingPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /3\.2/ }));
    });

    // jsdom cannot fire RAC's pointer/hover events (no PointerEvent), so the
    // open-tooltip visual is proven by the real-browser driver (qa rung 3);
    // here the accessible formula contract is pinned instead.
    const triggers = screen.getAllByTestId('billing-ap-deduction-trigger');
    expect(triggers).toHaveLength(2);
    expect(triggers[0]).toHaveAccessibleName(
      'Cấn trừ chi hộ: 4.500.000 cước − 4.000.000 UNC = 500.000 thực trả',
    );
  });

  it('empties the AP board for a month without vendor trips', async () => {
    render(<DemoBillingPage />);

    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: /3\.2/ }));
    });
    fireEvent.change(screen.getByLabelText('Kỳ đối soát'), { target: { value: '2026-11' } });

    expect(screen.getByText('Không có chuyến nào của nhà xe này trong kỳ đối soát.')).toBeInTheDocument();
  });
});
