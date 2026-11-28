import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuotationConfigPage from './QuotationConfigPage';

// SIL-1228 … SIL-1232 — the five /config/quotations defects QA filed on
// build 0c3e10f9 (staging vantai.tingting.vip, vai Quản trị viên):
//
//   SIL-1228  1440px — nhãn 'Khách hàng' nằm CẠNH ô chọn (inline) trong khi
//             nhãn 'Từ ngày' / 'Đến ngày' nằm TRÊN ô nhập: hai kiểu đặt nhãn
//             trong một thanh lọc, lệch 30px.
//   SIL-1229  390px — bảng danh mục phí rộng 480px trong viewport 390px, cột
//             THAO TÁC ([Xoá]) nằm ngoài màn hình và KHÔNG cuộn được (khối
//             bao overflow-x: visible).
//   SIL-1230  1440px — bảng danh mục phí chia 7 cột đều 163px: STT chứa 1–2
//             ký tự vẫn chiếm 163px, PHÂN LOẠI quấn 3 dòng, mọi hàng cao 61px.
//   SIL-1231  1440px — trạng thái trống neo ở đỉnh khung chi tiết, tâm khối
//             cao hơn tâm khung ~215px, còn ~500px nền trống phía dưới.
//   SIL-1232  dòng 'Độ trễ áp giá dầu' dùng từ kỹ thuật 'engine'.
//
// Layout lives in CSS, so the contracts are pinned the way the house pins
// them (see QuotationConfigPage.d3d5.test.tsx): the DOM carries the structure
// the sheet paints, and the sheet carries the geometry the DOM cannot.

const { apiGet, apiPut, apiGetBlob } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiGetBlob: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { get: apiGet, post: vi.fn(), put: apiPut, getBlob: apiGetBlob },
  ApiError: class ApiError extends Error {},
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const pageCss = readFileSync(resolve(process.cwd(), 'src/pages/config/QuotationConfigPage.css'), 'utf8');
const selectCss = readFileSync(resolve(process.cwd(), 'src/design-system/forms/UuiSelectField.css'), 'utf8');
const tableCss = readFileSync(resolve(process.cwd(), 'src/components/Table.css'), 'utf8');

const frames = [
  { id: 1, customerId: 7, customerName: 'Công ty A', templateName: 'Mẫu 1', effectiveDate: '2026-09-01', surchargeRoundingMode: 'NONE', fuelPriceLagDays: 1, note: null },
];

const feeCatalog = [
  { id: 91, feeName: 'Phụ phí', subType: 'KCN Quế Võ, Nam Sơn, Bắc Ninh · Cont 20 - Trọng tải < 20 tấn', defaultAmount: 160000, routing: 'OTHER_COSTS', note: null, sortOrder: 0 },
];

beforeEach(() => {
  apiGet.mockImplementation((path: string) => {
    if (path === '/quotations') return Promise.resolve(frames);
    if (path === '/quotations/1') return Promise.resolve({
      id: 1, customerId: 7, customerName: 'Công ty A', templateName: 'Mẫu 1', effectiveDate: '2026-09-01',
      surchargeRoundingMode: 'NONE', fuelPriceLagDays: 1, note: null, cells: [],
      fees: feeCatalog,
    });
    if (path.startsWith('/quotations/1/versions')) return Promise.resolve({ items: [], total: 0 });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

async function openFirstFrame() {
  render(<QuotationConfigPage />, { wrapper: makeWrapper() });
  const framesRegion = document.querySelector('.quotation-frames') as HTMLElement;
  fireEvent.click(await within(framesRegion).findByText('Công ty A'));
  await screen.findByRole('region', { name: 'Danh mục chi phí khác' });
}

describe('/config/quotations — filter label placement (SIL-1228)', () => {
  it('hosts the customer filter with a stacked label, like the date fields beside it', async () => {
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    const customer = await screen.findByLabelText('Khách hàng');
    const field = customer.closest('.ds-uui-select') as HTMLElement;
    // The field opts OUT of the filter band's inline label/control row: the
    // label sits on its own line above the trigger, so all three filter
    // groups share ONE label line and ONE control baseline.
    expect(field.className).toContain('ds-uui-select--stacked');
    // The label is rendered before the trigger (above it in the field).
    const label = field.querySelector('[data-label]') as HTMLElement;
    const trigger = field.querySelector('[data-uui-control="select"]') as HTMLElement;
    expect(label).toBeTruthy();
    expect(trigger).toBeTruthy();
    expect(label.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the bar inline row off a stacked select (shared sheet)', () => {
    expect(selectCss).toMatch(/\.filter-bar \.ds-uui-select:not\(\.ds-uui-select--stacked\)/);
    expect(selectCss).toMatch(/\.filter-bar \.ds-uui-select--stacked \.ds-uui-select__control\s*\{[^}]*flex-direction:\s*column/);
  });
});

describe('/config/quotations — fee catalog table (SIL-1229, SIL-1230)', () => {
  it('carries the fee catalog in the shared horizontal scroll host', async () => {
    await openFirstFrame();
    const host = document.querySelector('.quotation-fees .table-scroll') as HTMLElement;
    expect(host).toBeTruthy();
    // The table lives INSIDE the host — a table beside the host still paints
    // outside the viewport.
    expect(host.querySelector('table.quotation-fees__table')).toBeTruthy();
    // The shared host is the scroll contract: overflow-x: auto, so the
    // THAO TÁC column is reachable by scrolling.
    expect(tableCss).toMatch(/\.table-scroll\s*\{[^}]*overflow-x:\s*auto/);
  });

  it('sizes the columns by their content — STT narrow, PHÂN LOẠI wide', async () => {
    await openFirstFrame();
    const table = document.querySelector('table.quotation-fees__table') as HTMLElement;
    expect(table.querySelectorAll('thead th')).toHaveLength(7);

    // No equal-share columns any more: STT takes a narrow track and PHÂN LOẠI
    // the wide one (163px each was the reported defect).
    expect(pageCss).toMatch(/\.quotation-fees__table th:nth-child\(1\)\s*\{\s*width:\s*48px/);
    expect(pageCss).toMatch(/\.quotation-fees__table th:nth-child\(3\)\s*\{\s*width:\s*28%/);
    // The headers wrap instead of painting over the neighbour column, and the
    // table keeps a floor wide enough for its own controls.
    expect(pageCss).toMatch(/\.quotation-fees__table thead th\s*\{[^}]*white-space:\s*normal/);
    expect(pageCss).toMatch(/\.quotation-fees__table\s*\{[^}]*min-width:\s*\d+px/);
  });
});

describe('/config/quotations — empty detail pane (SIL-1231)', () => {
  it('centers the empty state in both axes of the visible detail column', async () => {
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    const detail = document.querySelector('.quotation-detail') as HTMLElement;
    expect(detail.className).toContain('is-empty');
    expect(await within(detail).findByText('Chọn một báo giá để xem lưới giá.')).toBeTruthy();

    // The pane stretches to the row and the row takes the page's remaining
    // height, so the state is centered on the column's vertical middle
    // instead of hanging at its top.
    expect(pageCss).toMatch(/\.quotation-detail\.is-empty\s*\{[^}]*place-items:\s*center[^}]*align-self:\s*stretch/);
    expect(pageCss).toMatch(/\.quotation-page\s*\{[^}]*min-height:\s*100%/);
    expect(pageCss).toMatch(/\.quotation-page:has\(\.quotation-detail\.is-empty\) \.quotation-layout\s*\{[^}]*flex:\s*1 1 auto/);
  });
});

describe('/config/quotations — lag strip wording (SIL-1232)', () => {
  it('never shows the internal term "engine" on the frame strip', async () => {
    await openFirstFrame();
    expect(screen.getByText(/hệ thống tra giá dầu kỳ \(ngày vận chuyển − độ trễ\)/)).toBeTruthy();
    expect(screen.queryByText(/engine/)).toBeNull();
  });
});
