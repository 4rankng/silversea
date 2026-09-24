// Card 20260922_57 — xlsx import/export flow (red-first importer suite).
// Drives the REAL fixture from testplan/fixtures (synthetic stand-in for the
// customer file, card table figures to the đồng) through the file input and
// pins the preview contract the acceptance cases demand:
//   TC-BG-13 customer full name + MST rendered; unknown customer surfaced
//            verbatim (never silently created)
//   TC-BG-14 unmatched factory names the row and blocks the commit
//   TC-BG-15 mapping preview before any write + Huỷ discards without writing
//   TC-BG-16 export downloads the current quotation as xlsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuotationConfigPage from './QuotationConfigPage';
import type { ImportPreviewPayload } from '../../api/quotationClient';

const { apiGet, apiUpload, apiGetBlob } = vi.hoisted(() => ({ apiGet: vi.fn(), apiUpload: vi.fn(), apiGetBlob: vi.fn() }));
vi.mock('../../lib/api', () => ({
  api: { get: apiGet, post: vi.fn(), put: vi.fn(), upload: apiUpload, getBlob: apiGetBlob },
  ApiError: class ApiError extends Error {},
}));

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const FIXTURE_NAME = '2026-09-23_bao-gia-mau-synthetic.xlsx';
const fixtureFile = new File(
  [readFileSync(resolve(process.cwd(), `../testplan/fixtures/${FIXTURE_NAME}`))],
  FIXTURE_NAME,
  { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
);

const LONG_MINH = 'CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH';
const frames = [
  { id: 5, customerId: 7, customerName: LONG_MINH, templateName: 'Mẫu báo giá 1', effectiveDate: '2026-09-01', note: null },
];

const cleanPreview: ImportPreviewPayload = {
  totalErrors: 0,
  sheets: [{
    sheet: 'BÁO GIÁ 1',
    customerName: LONG_MINH,
    customerId: 7,
    customerTaxCode: '2300540419',
    baseFuelPrice: 17842.593,
    fuelLagDays: 2,
    roundingMode: 'THOUSAND',
    routes: [{
      factoryName: 'ASKEY',
      routeId: 4,
      matchedRouteName: 'ASKEY',
      sharePct: 4,
      errors: [],
      rows: [
        { classCode: '1.25T', classLabel: 'Xe 1.25T', heSo: 1, liters: 20, giaCos: 1248000, basePrice: 1200000, billingKmOneWay: 100, error: null },
        { classCode: 'CONT20.LIGHT', classLabel: 'Cont20 <20t', heSo: 1, liters: 64, giaCos: 3952000, basePrice: 3800000, billingKmOneWay: 100, error: null },
      ],
    }],
    errors: [],
  }],
};

function previewRegion(): HTMLElement {
  return screen.getByRole('region', { name: 'Xem trước nhập xlsx' });
}

async function selectFixture(): Promise<HTMLInputElement> {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [fixtureFile] } });
  await screen.findByRole('region', { name: 'Xem trước nhập xlsx' });
  return input;
}

beforeEach(() => {
  apiGet.mockImplementation((path: string) => {
    if (path === '/quotations') return Promise.resolve(frames);
    if (path === '/quotations/5/versions') return Promise.resolve({ items: [], total: 0 });
    if (path === '/quotations/5') return Promise.resolve({
      id: 5, customerId: 7, customerName: LONG_MINH, templateName: 'Mẫu báo giá 1',
      effectiveDate: '2026-09-01', surchargeRoundingMode: 'THOUSAND', note: null, cells: [],
      fees: [],
    });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  apiUpload.mockReset();
  apiUpload.mockImplementation((path: string) => Promise.reject(new Error(`unexpected upload ${path}`)));
  apiGetBlob.mockReset();
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('quotation xlsx import preview (card 20260922_57, TC-BG-13/14/15)', () => {
  it('TC-BG-15: uploads the picked fixture to /quotations/import and renders the mapping preview', async () => {
    apiUpload.mockResolvedValueOnce(cleanPreview);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    await selectFixture();

    expect(apiUpload).toHaveBeenCalledTimes(1);
    const [path, body] = apiUpload.mock.calls[0];
    expect(path).toBe('/quotations/import');
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe(FIXTURE_NAME);

    const preview = previewRegion();
    // TC-BG-13: the matched customer renders with its full name AND MST.
    expect(within(preview).getByText(new RegExp(LONG_MINH))).toBeTruthy();
    expect(within(preview).getByText(/MST 2300540419/)).toBeTruthy();
    // Factory → route mapping and figures rendered for đồng-level reading.
    expect(within(preview).getByText('✓ ASKEY → ASKEY')).toBeTruthy();
    expect(within(preview).getByText(/Xe 1\.25T: 20 lít · 1\.248\.000 ₫/)).toBeTruthy();
    expect(within(preview).getByText(/khớp toàn bộ/)).toBeTruthy();
    expect(within(preview).getByRole('button', { name: 'Ghi nhận nhập file' })).toBeEnabled();
  });

  it('TC-BG-13: an unknown customer surfaces the sheet error verbatim and blocks the commit', async () => {
    apiUpload.mockResolvedValueOnce({
      totalErrors: 1,
      sheets: [{
        sheet: 'LOG COM',
        customerName: null,
        customerId: null,
        customerTaxCode: '0000000000',
        baseFuelPrice: null,
        fuelLagDays: null,
        roundingMode: 'NONE',
        routes: [],
        errors: ['Không nhận diện được khách hàng trong danh mục (theo tên đầy đủ hoặc MST).'],
      }],
    } satisfies ImportPreviewPayload);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    await selectFixture();
    const preview = previewRegion();

    expect(within(preview).getByText(/Không nhận diện được khách hàng trong danh mục/)).toBeTruthy();
    expect(within(preview).getByText(/1 lỗi ánh xạ/)).toBeTruthy();
    expect(within(preview).getByRole('button', { name: 'Ghi nhận nhập file' })).toBeDisabled();
  });

  it('TC-BG-14: an unmatched factory names the row and blocks the commit', async () => {
    apiUpload.mockResolvedValueOnce({
      totalErrors: 1,
      sheets: [{
        sheet: 'BÁO GIÁ 1',
        customerName: LONG_MINH,
        customerId: 7,
        customerTaxCode: '2300540419',
        baseFuelPrice: 17842.593,
        fuelLagDays: 2,
        roundingMode: 'THOUSAND',
        routes: [{
          factoryName: 'XƯỞNG KHÔNG CÓ TRONG DANH MỤC',
          routeId: null,
          matchedRouteName: null,
          sharePct: null,
          rows: [],
          errors: ['Không tìm thấy tuyến đường cho nhà máy "XƯỞNG KHÔNG CÓ TRONG DANH MỤC".'],
        }],
        errors: [],
      }],
    } satisfies ImportPreviewPayload);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    await selectFixture();
    const preview = previewRegion();

    expect(within(preview).getByText(/✗ Không tìm thấy tuyến đường cho nhà máy "XƯỞNG KHÔNG CÓ TRONG DANH MỤC"\./)).toBeTruthy();
    expect(within(preview).getByRole('button', { name: 'Ghi nhận nhập file' })).toBeDisabled();
  });

  it('D1: a blank Giá cos cell is a blocking preview error — no ✓, banner counts it, commit locked (preview ≡ commit)', async () => {
    apiUpload.mockResolvedValueOnce({
      ...cleanPreview,
      // Preview ≡ commit is enforced in the BE service (quotation-import.service
      // flags blank/non-positive Giá cos as a row error counted in totalErrors);
      // the FE renders what the service emits. This mock mirrors the service's
      // real blank-cell payload. The FE-local-catch design this test originally
      // encoded never shipped — the test was red at HEAD and at its own landing
      // 2d07c15a (adjudicated 2026-09-24).
      totalErrors: 1,
      sheets: [{
        ...cleanPreview.sheets[0],
        routes: [{
          ...cleanPreview.sheets[0].routes[0],
          rows: [
            { classCode: '1.25T', classLabel: 'Xe 1.25T', heSo: 1, liters: 20, giaCos: null, basePrice: null, billingKmOneWay: 100, error: 'Xe 1.25T: thiếu hoặc sai Giá cos — điền số tiền > 0 (số, VD 1234567 hoặc 1.234.567).' },
            ...cleanPreview.sheets[0].routes[0].rows.slice(1),
          ],
        }],
      }],
    } satisfies ImportPreviewPayload);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    await selectFixture();
    const preview = previewRegion();

    // The blank-price row renders ✗ with the service's cell-naming error — never "✓ … ? ₫".
    expect(within(preview).getByText(/✗ Xe 1\.25T: thiếu hoặc sai Giá cos/)).toBeTruthy();
    expect(within(preview).queryByText(/✓ Xe 1\.25T/)).toBeNull();
    // The banner counts the service-emitted error and locks the commit.
    expect(within(preview).getByText(/1 lỗi ánh xạ/)).toBeTruthy();
    expect(within(preview).getByRole('button', { name: 'Ghi nhận nhập file' })).toBeDisabled();
  });

  it('TC-BG-15: Huỷ discards the preview without any write and the file can be re-picked', async () => {
    apiUpload.mockResolvedValueOnce(cleanPreview);
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    await selectFixture();

    fireEvent.click(screen.getByRole('button', { name: 'Huỷ' }));
    expect(screen.queryByRole('region', { name: 'Xem trước nhập xlsx' })).toBeNull();
    expect(apiUpload).toHaveBeenCalledTimes(1); // preview only — nothing was written

    apiUpload.mockResolvedValueOnce(cleanPreview);
    await selectFixture(); // fresh state accepts the same file again
    await waitFor(() => expect(apiUpload).toHaveBeenCalledTimes(2));
  });
});

describe('quotation xlsx commit + export (card 20260922_57, TC-BG-16)', () => {
  it('commits with an Idempotency-Key and clears the preview on success', async () => {
    apiUpload
      .mockResolvedValueOnce(cleanPreview)
      .mockResolvedValueOnce({ results: [{ sheet: 'BÁO GIÁ 1', quotationId: 11, customerName: LONG_MINH, errors: [] }] });
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    await selectFixture();
    const getBefore = apiGet.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận nhập file' }));
    await waitFor(() => expect(apiUpload).toHaveBeenCalledTimes(2));
    const [path, body, options] = apiUpload.mock.calls[1];
    expect(path).toBe('/quotations/import/commit');
    expect((body.get('file') as File).name).toBe(FIXTURE_NAME);
    expect(options?.headers?.['Idempotency-Key']).toBeTruthy();

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Xem trước nhập xlsx' })).toBeNull());
    await waitFor(() => expect(apiGet.mock.calls.length).toBeGreaterThan(getBefore)); // frames refetched
  });

  it('surfaces commit errors verbatim and keeps the preview so the user can cancel', async () => {
    apiUpload
      .mockResolvedValueOnce(cleanPreview)
      .mockResolvedValueOnce({
        results: [{
          sheet: 'BÁO GIÁ 1',
          quotationId: null,
          customerName: LONG_MINH,
          errors: ['ASKEY · Xe 1.25T: không có định mức dầu cho 1.25T.'],
        }],
      });
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    await selectFixture();

    fireEvent.click(screen.getByRole('button', { name: 'Ghi nhận nhập file' }));
    expect(await screen.findByText(/không có định mức dầu cho 1\.25T/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Xem trước nhập xlsx' })).toBeTruthy();
  });

  it('TC-BG-16: Xuất xlsx downloads the selected quotation through /export', async () => {
    apiGetBlob.mockResolvedValue(new Blob(['xlsx']));
    const downloads: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    render(<QuotationConfigPage />, { wrapper: makeWrapper() });
    const framesRegion = document.querySelector('.quotation-frames') as HTMLElement;
    fireEvent.click(await within(framesRegion).findByText(LONG_MINH));

    fireEvent.click(screen.getByRole('button', { name: 'Xuất xlsx' }));
    await waitFor(() => expect(apiGetBlob).toHaveBeenCalledWith('/quotations/5/export'));
    await waitFor(() => expect(downloads).toContain('bao-gia-5.xlsx'));
    clickSpy.mockRestore();
  });
});
