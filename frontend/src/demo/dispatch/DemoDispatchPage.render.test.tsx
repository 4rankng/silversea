/**
 * Component tests cho /demo/dispatch (SIL-156/157/158) — xem
 * testplan/2026-10-24-sil156-158-demo-dispatch.md (TC-SIL156/157/158).
 * Render toàn trang qua AppRoutes như demo-shell.routes.test.tsx để pin cả
 * wiring thật (lazy route + DemoAppShell + ToastProvider).
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

const { authState } = vi.hoisted(() => ({
  authState: { isAuthenticated: true as boolean },
}));

vi.mock('../../hooks/useAuth', async () => {
  const actual = await vi.importActual<typeof import('../../hooks/useAuth')>('../../hooks/useAuth');
  return {
    ...actual,
    useAuth: () => ({
      user: { userId: 1, username: 'admin', email: null, phone: null, role: 'ADMIN' as Role, fullName: 'Điều Vận Demo' },
      logout: vi.fn(),
      login: vi.fn(),
      updateUser: vi.fn(),
      isAuthenticated: authState.isAuthenticated,
      loading: false,
      sessionExpired: false,
    }),
  };
});

import { ToastProvider } from '../../components/shared/Toast';
import { AppRoutes } from '../../App';

const writeText = vi.fn(async (_text: string) => {});

function renderDispatch() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/demo/dispatch']}>
        <AppRoutes />
      </MemoryRouter>
    </ToastProvider>,
  );
}

function gridRows() {
  return document.querySelectorAll('[data-testid="demo-dispatch-grid"] tbody tr');
}

/**
 * UuiSelectField exposes a hidden native select whose value is the option
 * VALUE (not label). Resolve the right control by an option label only it
 * carries, then drive it like the house idiom (fireEvent.change).
 */
function hiddenSelectWithOption(optionText: string): HTMLSelectElement {
  const select = Array.from(document.querySelectorAll('select')).find((s) =>
    Array.from(s.options).some((o) => o.textContent === optionText),
  );
  if (!select) throw new Error(`No hidden select has option "${optionText}"`);
  return select as HTMLSelectElement;
}

beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('TC-SIL156-01 — date bar + KPI', () => {
  it('defaults to Hôm nay (2026-10-24) with seed KPI numbers', async () => {
    renderDispatch();
    expect(await screen.findByTestId('demo-kpi-total')).toHaveTextContent('16');
    expect(screen.getByTestId('demo-kpi-inhouse')).toHaveTextContent('13');
    expect(screen.getByTestId('demo-kpi-vendor')).toHaveTextContent('3');
    expect(screen.getByTestId('demo-kpi-warnings')).toHaveTextContent('3');
    expect(screen.getByTestId('demo-dispatch-day-label')).toHaveTextContent('Thứ Bảy, 24/10');
  });

  it('switching to Hôm qua narrows the grid to the 2 seeded trips', async () => {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');
    expect(gridRows()).toHaveLength(16);
    fireEvent.click(screen.getByRole('tab', { name: 'Hôm qua' }));
    await waitFor(() => expect(gridRows()).toHaveLength(2));
    expect(screen.getByText('CH-2310-01')).toBeInTheDocument();
  });
});

describe('TC-SIL156-02 — 6-column grid, 3-line cells, no money column', () => {
  it('renders the six spec column headers and seeded row facts', async () => {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');
    for (const header of [
      'Thời gian & Phương tiện',
      'Khách hàng & Điểm đóng/trả',
      'Lộ trình bãi & Tham chiếu',
      'Thông số Container',
      'Yêu cầu & Ghi chú hiện trường',
      'Trạng thái & Tín hiệu nâng/hạ',
    ]) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    // Chạy kẹp tag trên cặp T-2403/T-2404 (cùng booking SITVBM9911455).
    expect(screen.getAllByText(/KẸP/).length).toBeGreaterThanOrEqual(2);
    // Tín hiệu UNC: T-2401 nâng đã UNC, hạ chờ KT UNC.
    expect(screen.getAllByText('Nâng: Đã UNC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hạ: Chờ KT UNC').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nâng: LX Chi').length).toBeGreaterThan(0);
    // Không ô nào hiển thị số tiền (cước/phí) trên lưới.
    expect(screen.queryByText(/4\.800\.000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2\.150\.000/)).not.toBeInTheDocument();
  });

  it('flags export trips missing the container spec in orange', async () => {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');
    expect(screen.getAllByText('Chưa đủ thông số vỏ').length).toBe(3);
  });
});

describe('TC-SIL156-03 — filters, search, create modal', () => {
  it('filters by customer then by source, and searches by plate', async () => {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');

    fireEvent.change(hiddenSelectWithOption('SAM — Samsung Electronics HCM CE'), {
      target: { value: 'SAM' },
    });
    await waitFor(() => expect(gridRows()).toHaveLength(2));

    fireEvent.change(hiddenSelectWithOption('SAM — Samsung Electronics HCM CE'), {
      target: { value: 'all' },
    });
    fireEvent.change(hiddenSelectWithOption('Xe ngoài'), { target: { value: 'vendor' } });
    await waitFor(() => expect(gridRows()).toHaveLength(3));

    fireEvent.change(hiddenSelectWithOption('Xe ngoài'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Tìm chuyến'), { target: { value: '51C-138.65' } });
    await waitFor(() => expect(gridRows()).toHaveLength(2));
  });

  it('clones trips from one booking via the create modal', async () => {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');
    fireEvent.click(screen.getByTestId('demo-dispatch-create'));

    const modal = await screen.findByTestId('demo-dispatch-create-modal');
    fireEvent.change(within(modal).getByLabelText('Mã Booking / Lệnh giao hàng'), {
      target: { value: 'TESTBOOK99' },
    });
    fireEvent.change(within(modal).getByLabelText('Số vỏ nhân bản'), { target: { value: '2' } });
    fireEvent.click(within(modal).getByTestId('demo-create-submit'));

    await waitFor(() => expect(gridRows()).toHaveLength(18));
    expect(screen.getAllByText('TESTBOOK99').length).toBeGreaterThanOrEqual(2);
  });
});

describe('TC-SIL157-01 — gantt timeline', () => {
  it('switches to the fleet timeline with 6 truck lanes and clickable blocks', async () => {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');
    fireEvent.click(screen.getByTestId('demo-view-timeline'));

    const gantt = await screen.findByTestId('demo-dispatch-gantt');
    expect(await within(gantt).findByText('51C-138.65')).toBeInTheDocument();
    expect(gantt.querySelectorAll('[data-testid="demo-gantt-lane"]')).toHaveLength(6);
    expect(gantt.querySelectorAll('[data-testid="demo-gantt-block"]').length).toBe(13);

    // Click khối → mở drawer cùng chuyến.
    fireEvent.click(gantt.querySelectorAll('[data-testid="demo-gantt-block"]')[0]);
    expect(await screen.findByTestId('demo-dispatch-drawer')).toBeInTheDocument();
  });

  it('hides the now-line on days other than demo today', async () => {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');
    fireEvent.click(screen.getByRole('tab', { name: 'Hôm qua' }));
    fireEvent.click(screen.getByTestId('demo-view-timeline'));
    const gantt = await screen.findByTestId('demo-dispatch-gantt');
    expect(gantt.querySelector('[data-testid="demo-gantt-nowline"]')).toBeNull();
  });
});

describe('TC-SIL158-01 — drawer 40%', () => {
  async function openFirstTripDrawer() {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');
    fireEvent.click(screen.getAllByText('CH-2410-01')[0].closest('tr')!);
    return await screen.findByTestId('demo-dispatch-drawer');
  }

  it('shows the 3 blocks and saves an edited seal back onto the grid', async () => {
    const drawer = await openFirstTripDrawer();
    for (const title of [
      'Phân bổ phương tiện',
      'Thông số cont & chứng từ hiện trường',
      'Cấu hình chi phí nâng / hạ',
    ]) {
      expect(within(drawer).getByText(title)).toBeInTheDocument();
    }
    expect(within(drawer).getByText('Phí nâng vỏ / hàng')).toBeInTheDocument();
    expect(within(drawer).getByText('Phí hạ bãi')).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /Copy thông tin đăng ký xe/ })).toBeInTheDocument();

    const seal = within(drawer).getByLabelText('Số chì (Seal)');
    fireEvent.change(seal, { target: { value: 'SL-NEW-01' } });
    fireEvent.click(within(drawer).getByTestId('demo-drawer-save'));

    await waitFor(() => {
      expect(screen.queryByTestId('demo-dispatch-drawer')).not.toBeInTheDocument();
    });
    expect(await screen.findByText('SL-NEW-01')).toBeInTheDocument();
  });

  it('auto-fills driver info when the truck changes and copies registration to clipboard', async () => {
    const drawer = await openFirstTripDrawer();
    fireEvent.change(hiddenSelectWithOption('60C-229.15 — Howo TX'), {
      target: { value: 'TRK-03' },
    });
    expect(await within(drawer).findByText('Trần Văn Hậu')).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: /Copy thông tin đăng ký xe/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain('60C-229.15');
    expect(writeText.mock.calls[0][0]).toContain('034203003910');
  });

  it('Hủy discards edits', async () => {
    const drawer = await openFirstTripDrawer();
    fireEvent.change(within(drawer).getByLabelText('Số chì (Seal)'), { target: { value: 'NOPE' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByTestId('demo-dispatch-drawer')).not.toBeInTheDocument());
    expect(screen.queryByText('NOPE')).not.toBeInTheDocument();
  });
});

describe('grid copy vehicle button', () => {
  it('copies the standard vehicle string to the clipboard', async () => {
    renderDispatch();
    await screen.findByTestId('demo-dispatch-grid');
    fireEvent.click(screen.getAllByRole('button', { name: /Copy thông tin xe chuyến CH-2410-01/ })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toBe(
      '51C-138.65 / 51R-072.44 / Nguyễn Văn Tâm / 0903 715 204 / 034201001234',
    );
  });
});
