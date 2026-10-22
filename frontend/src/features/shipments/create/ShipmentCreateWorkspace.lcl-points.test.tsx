import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('./FreightPreviewCard', () => ({ FreightPreviewCard: () => null }));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof ShipmentClientModule>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

import type * as ShipmentClientModule from '../../../api/shipmentClient';
import { ToastProvider } from '../../../components/shared/Toast';
import { ShipmentCreateWorkspace } from './ShipmentCreateWorkspace';

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/shipments/new']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ShipmentCreateWorkspace />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const fieldText = (fieldId: string) => document.querySelector(`[data-field-id="${fieldId}"]`)!.textContent?.replace(/\s+/g, ' ').trim() ?? '';

async function enterLclWithCatalogCustomer() {
  renderWorkspace();
  await screen.findByRole('button', { name: 'Tạo lô hàng' });
  fireEvent.click(screen.getByRole('combobox', { name: 'Khách hàng' }));
  fireEvent.click(await screen.findByRole('option', { name: 'KH A' }));
  fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
  await waitFor(() => expect(document.querySelector('[data-field-id="shipment-pickup-warehouse"]')).toBeTruthy());
}

async function chooseDirection(label: string) {
  fireEvent.click(document.getElementById('shipment-trade-direction')!);
  fireEvent.click(await screen.findByRole('option', { name: label }));
  await waitFor(() => expect(screen.getByRole('radio', { name: /Hàng lẻ/ })).toBeChecked());
}

/** Card 171026115800 (FB-105, spec §2) — the hàng lẻ operating-point labels,
 *  placeholders, required marks and the layout move of the Kho (CFS/Cảng)
 *  picker into the "Điểm vận hành & tuyến" card. */
describe('hàng lẻ operating points (FB-105)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    listOperationalSites.mockReset();
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    // Card 261022093245: the kho picker reads the SHARED catalog, not the
    // customer's own sites — mirror the BE `?scope=shared` response.
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
  });

  it('names the Kho and the Nhà máy by hình thức xuất nhập khẩu', async () => {
    await enterLclWithCatalogCustomer();

    // Direction not chosen yet: the pre-FB-105 labels stand (nothing invented).
    expect(fieldText('shipment-operational-site')).toContain('Nhà máy');
    expect(fieldText('shipment-pickup-warehouse')).toContain('Kho lấy hàng');

    await chooseDirection('Nhập khẩu');
    expect(fieldText('shipment-operational-site')).toContain('Nhà máy (Điểm trả hàng)');
    expect(fieldText('shipment-pickup-warehouse')).toContain('Kho lấy hàng (CFS/Cảng)');
    expect(document.querySelector<HTMLInputElement>('[data-field-id="shipment-pickup-warehouse"] input')!.placeholder).toBe('Chọn hoặc nhập kho CFS lấy hàng...');
    // Both points are enforced for a catalog lot.
    expect(fieldText('shipment-operational-site')).toContain('*');
    expect(fieldText('shipment-pickup-warehouse')).toContain('*');

    await chooseDirection('Xuất khẩu');
    expect(fieldText('shipment-operational-site')).toContain('Nhà máy (Điểm lấy hàng)');
    expect(fieldText('shipment-pickup-warehouse')).toContain('Kho trả hàng (CFS/Cảng)');
    expect(document.querySelector<HTMLInputElement>('[data-field-id="shipment-pickup-warehouse"] input')!.placeholder).toBe('Chọn hoặc nhập kho CFS hạ/giao hàng...');
  });

  it('keeps both operating points inside the "Điểm vận hành & tuyến" card', async () => {
    await enterLclWithCatalogCustomer();

    const warehouse = document.querySelector('[data-field-id="shipment-pickup-warehouse"]')!;
    const factory = document.querySelector('[data-field-id="shipment-operational-site"]')!;
    const route = document.querySelector('[data-field-id="shipment-route"]')!;
    expect(warehouse.closest('section')).toBe(factory.closest('section'));
    expect(warehouse.closest('section')).toBe(route.closest('section'));
    expect(warehouse.closest('section')!.textContent).toContain('Điểm vận hành & tuyến');
    // …and the cargo card is left with the cargo fields only.
    const cargoSection = document.querySelector('[data-field-id="shipment-package-type"]')!.closest('section')!;
    expect(cargoSection.textContent).toContain('Thông tin hàng');
    expect(cargoSection.contains(warehouse)).toBe(false);
  });

  it('counts typed operating points as filled (both fields accept free text)', async () => {
    await enterLclWithCatalogCustomer();
    await chooseDirection('Nhập khẩu');

    const before = document.querySelector('.csc-topline__progress')!.textContent!.replace(/\s+/g, ' ').trim();

    // Typing (not picking) must commit through onCustomValue: the field is a
    // searchable combobox, so the raw text rides the custom-value channel.
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-field-id="shipment-operational-site"] input')!, { target: { value: 'Nhà máy gõ tay' } });
    fireEvent.change(document.querySelector<HTMLInputElement>('[data-field-id="shipment-pickup-warehouse"] input')!, { target: { value: 'Kho CFS gõ tay' } });

    await waitFor(() => {
      const text = document.querySelector('.csc-topline__progress')!.textContent!.replace(/\s+/g, ' ').trim();
      const [done, total] = text.replace('Bắt buộc: ', '').split('/').map(Number);
      const [, beforeTotal] = before.replace('Bắt buộc: ', '').split('/').map(Number);
      const [beforeDone] = before.replace('Bắt buộc: ', '').split('/').map(Number);
      expect(total).toBe(beforeTotal);
      expect(done).toBe(beforeDone + 2);
    });
    // …and neither point is reported missing any more.
    expect(document.querySelector('[data-field-id="shipment-pickup-warehouse"]')!.querySelector('.csc-searchable-field--error')).toBeNull();
    expect(document.querySelector('[data-field-id="shipment-operational-site"]')!.querySelector('.csc-searchable-field--error')).toBeNull();
  });

  it('repeats the Huỷ / Lưu nháp / Tạo lô hàng cluster at the end of the page', async () => {
    await enterLclWithCatalogCustomer();

    const footer = document.querySelector('.csc-form-actions')!;
    expect(footer).toBeTruthy();
    const labels = Array.from(footer.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'));
    // Card 171026115830 (FB-108): the footer cluster names itself so its buttons
    // stay distinguishable from the identical topline cluster.
    expect(labels).toEqual(['Huỷ (cuối trang)', 'Lưu nháp (cuối trang)', 'Tạo lô hàng (cuối trang)']);
    // The topline cluster still exists and keeps the plain names.
    expect(screen.getByRole('button', { name: 'Tạo lô hàng' })).toBeTruthy();
  });

  // Card 181026143000 (spec 2026.10.17 §1a/§1c): the kho quick-add dialog
  // must name the SAME direction as the field it opens from — the spec's core
  // complaint was a hard-coded "Kho lấy hàng" applied to both directions.
  it('titles the kho quick-add dialog by hình thức xuất nhập khẩu', async () => {
    await enterLclWithCatalogCustomer();

    await chooseDirection('Xuất khẩu');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm kho' }));
    const exportDialog = await screen.findByRole('dialog', { name: 'Thêm kho trả hàng' });
    expect(exportDialog).toBeTruthy();
    fireEvent.click(within(exportDialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await chooseDirection('Nhập khẩu');
    fireEvent.click(screen.getByRole('button', { name: 'Thêm kho' }));
    const importDialog = await screen.findByRole('dialog', { name: 'Thêm kho lấy hàng' });
    expect(importDialog).toBeTruthy();
    fireEvent.click(within(importDialog).getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  // Card 181026143000 §1c: "+ Thêm kho" is the shared dashed utility button —
  // no page-local inline palette (the old copy carried a blue #2563eb token
  // fallback). One pattern, one class, like the "+ Thêm nhà máy" sibling.
  it('renders "+ Thêm kho" through the shared dashed utility button', async () => {
    await enterLclWithCatalogCustomer();

    const themKho = screen.getByRole('button', { name: 'Thêm kho' });
    expect(themKho.className).toContain('csc-utility-button--dashed');
    const themNhaMay = screen.getByRole('button', { name: 'Thêm nhà máy' });
    expect(themNhaMay.className).toBe(themKho.className);
    expect(themKho.getAttribute('style')).toBe('align-self: start;');
  });

  // Card 261022093245 (Zalo 22/10): a CFS/depot is shared infrastructure —
  // the kho dropdown must list the SHARED catalog, never only the lot
  // customer's own warehouses. Before the fix a customer with no kho saw
  // "Chưa có kho cho khách hàng này" and was forced into "+ Thêm kho".
  describe('kho (CFS/Cảng) lists the shared warehouse catalog (card 261022093245)', () => {
    it('offers shared-catalog warehouses for a customer with NO warehouses of its own', async () => {
      // The lot customer owns only a factory — the kho options must still
      // come from the shared catalog (other customers' active warehouses).
      listOperationalSites.mockResolvedValue([
        { id: 41, siteType: 'FACTORY', name: 'Nhà máy Long Minh', shortName: 'NM Long Minh' },
      ]);
      listSharedWarehouseSites.mockResolvedValue([
        { id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' },
        { id: 442, customerId: 4, siteType: 'WAREHOUSE', name: 'ICD Hà Nội', shortName: 'ICD Hà Nội' },
      ]);

      await enterLclWithCatalogCustomer();
      // "+ Thêm kho" stays available — creating a kho is still useful, just
      // no longer the only way forward. (Assert before opening the listbox:
      // while open, Radix aria-hides the rest of the page.)
      expect(screen.getByRole('button', { name: 'Thêm kho' })).toBeTruthy();
      fireEvent.click(document.querySelector('[data-field-id="shipment-pickup-warehouse"] [role="combobox"]')!);
      expect(await screen.findByRole('option', { name: 'ICD Hà Nội' })).toBeTruthy();
      expect(screen.getByRole('option', { name: 'Kho A' })).toBeTruthy();
      expect(listSharedWarehouseSites).toHaveBeenCalled();
      // The dead-end hint is gone while the shared catalog still lists kho.
      expect(document.querySelector('[data-field-id="shipment-pickup-warehouse"]')!.textContent)
        .not.toContain('Chưa có kho cho khách hàng này');
    });

    it('keeps the dropdown disabled until a customer is chosen', async () => {
      renderWorkspace();
      await screen.findByRole('button', { name: 'Tạo lô hàng' });
      fireEvent.click(screen.getByRole('radio', { name: /Hàng lẻ/ }));
      const combo = document.querySelector('[data-field-id="shipment-pickup-warehouse"] [role="combobox"]') as HTMLButtonElement;
      await waitFor(() => expect(combo.disabled).toBe(true));
      expect(document.querySelector<HTMLInputElement>('[data-field-id="shipment-pickup-warehouse"] input')!.placeholder)
        .toBe('Chọn khách hàng trước');
    });

    it('falls back to the "Chưa có kho trong danh mục" hint only when the SHARED catalog is empty', async () => {
      listOperationalSites.mockResolvedValue([]);
      listSharedWarehouseSites.mockResolvedValue([]);

      await enterLclWithCatalogCustomer();
      const field = document.querySelector('[data-field-id="shipment-pickup-warehouse"]')!;
      // Reworded: the limit is the shared danh mục, not the customer's own
      // assignment — and the quick-add link still rides the hint.
      await waitFor(() => expect(field.textContent).toContain('Chưa có kho trong danh mục'));
      expect(field.textContent).not.toContain('Chưa có kho cho khách hàng này');
    });
  });
});
