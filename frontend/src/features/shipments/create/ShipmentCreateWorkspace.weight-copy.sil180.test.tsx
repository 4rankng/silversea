import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getBootstrap, listOperationalSites, listSharedWarehouseSites } = vi.hoisted(() => ({ getBootstrap: vi.fn(), listOperationalSites: vi.fn(), listSharedWarehouseSites: vi.fn() }));
vi.mock('../../../api/tripClient', () => ({
  tripClient: { getBootstrap },
}));
vi.mock('../../../api/shipmentClient', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/shipmentClient')>(),
  listOperationalSites,
  listSharedWarehouseSites,
}));

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

function addContainer() {
  fireEvent.click(screen.getByRole('button', { name: 'Thêm container' }));
}

function weightTriggers() {
  return [...screen.getAllByRole('button', { name: /Chỉnh sửa trọng lượng — dòng \d+/ })];
}

/** SIL-552: the weight line is a ghost trigger — open its floating editor,
 *  type, Enter commits and closes the panel. */
function fillWeight(index: number, value: string) {
  fireEvent.click(weightTriggers()[index]!);
  const input = screen.getByLabelText(`Trọng lượng (kg) — dòng ${index + 1}`) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

/** Opens row `index`'s weight panel and returns the seeded input value. */
function weightValue(index: number): string {
  fireEvent.click(weightTriggers()[index]!);
  return (screen.getByLabelText(`Trọng lượng (kg) — dòng ${index + 1}`) as HTMLInputElement).value;
}

function numberInputs() {
  return [...screen.getAllByLabelText('Số container')] as HTMLInputElement[];
}

function typeEditTriggers() {
  return [...screen.getAllByRole('button', { name: /Chỉnh sửa loại container — dòng \d+/ })];
}

/**
 * SIL-180 (FB-111 / R8, Frank ruling 06/11 verbatim: trọng lượng PHẢI copy
 * khi thêm container) — pressing "Thêm container" inherits the adjacent
 * previous row's shared fields (route, factory, ports, schedule window AND
 * TRỌNG LƯỢNG), leaving ONLY the two per-container identifiers empty (Số
 * container + Loại cont, REQ-22 reversed). Frank's 06/11 drive saw the
 * weight cell EMPTY on both Tạo and Sửa — both forms share THIS workspace's
 * single add seam (SIL-171), so a workspace-level pin locks the ruling on
 * the exact surface he drove (the model-level pin already lives in
 * shipment-create-model.test.tsx).
 */
describe('Thêm container copies the previous row including trọng lượng (SIL-180)', { timeout: 20000 }, () => {
  beforeEach(() => {
    getBootstrap.mockReset();
    getBootstrap.mockResolvedValue({
      customers: [{ id: 1, name: 'KH A' }],
      routes: [{ id: 7, name: 'Route A' }],
    });
    listOperationalSites.mockReset();
    listSharedWarehouseSites.mockReset();
    listSharedWarehouseSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
    listOperationalSites.mockResolvedValue([{ id: 12, siteType: 'WAREHOUSE', name: 'Kho A', shortName: 'Kho A' }]);
  });

  it('row 2 inherits row 1 weight (10.000 kg → 12.000 kg case), Số cont + Loại cont stay empty', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fillWeight(0, '10000');
    addContainer();
    expect(weightTriggers()).toHaveLength(2);
    expect(weightValue(1)).toBe('10000');
    // The display cell renders the formatted kilos, not a blank.
    expect(screen.getAllByText('10.000').length).toBeGreaterThan(0);
    // The two per-container identifiers stay the operator's own entry.
    expect(numberInputs()[1]!.value).toBe('');
    // The LOẠI ghost line shows the empty placeholder ("Chọn loại"), never
    // an inherited code.
    expect(typeEditTriggers().length).toBe(2);
    const typeLine = typeEditTriggers()[1]!.closest('.csc-group-floating-line') ?? typeEditTriggers()[1]!;
    expect(typeLine.textContent).toContain('Chọn loại');
  });

  it('row 3 clones the ADJACENT previous row (12.000), not the first row', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    fillWeight(0, '10000');
    addContainer();
    fillWeight(1, '12000');
    addContainer();
    expect(weightTriggers()).toHaveLength(3);
    expect(weightValue(2)).toBe('12000');
    expect(numberInputs()[2]!.value).toBe('');
  });

  it('an empty source row seeds an empty weight (no fabricated number)', async () => {
    renderWorkspace();
    await screen.findByRole('button', { name: 'Tạo lô hàng' });
    addContainer();
    expect(weightValue(1)).toBe('');
  });
});
