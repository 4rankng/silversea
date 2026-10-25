import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShipmentCreateTopline } from './ShipmentCreateTopline';
import { requiredCompletion } from './ShipmentCreateTopline.progress';
import {
  EMPTY_SHIPMENT_CREATE_FORM,
  createEmptyContainer,
  getShipmentCreateReadiness,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
} from './shipment-create-model';

/** Same source the workspace feeds the chip: the live readiness issue list. */
function completion(
  form: ShipmentCreateFormState,
  containers: ShipmentContainerDraft[] = [createEmptyContainer()],
) {
  return requiredCompletion(form, containers, getShipmentCreateReadiness(form, containers).issues);
}

const IDENTITY_FILLED = {
  ...EMPTY_SHIPMENT_CREATE_FORM,
  customerId: '1',
  tradeDirection: 'IMPORT' as const,
  blNumber: 'BL-171026113510',
};

const FULL_FCL_ROW: ShipmentContainerDraft = {
  ...createEmptyContainer(),
  containerTypeId: '3',
  operationalSiteId: '4',
  routeId: '5',
  pickupPortId: '6',
  dropoffPortId: '7',
  customerAppointmentAt: '2026-08-14T09:00',
};

const FULL_LCL_FORM: ShipmentCreateFormState = {
  ...IDENTITY_FILLED,
  cargoMode: 'LCL',
  routeId: '7',
  operationalSiteId: '4',
  pickupWarehouseSiteId: '12',
  packageType: 'Pallet',
  packageCount: '5',
  cargoWeightKg: '300',
  expectedDeliveryDate: '2026-08-20',
};

// Card 171026113510 (QA1-007 verify-fail lần 2): the chip used to count only
// the three `*`-marked identity fields (`requiredTotal` was hardcoded 3, with a
// `Math.max(3, …)` floor), so "Bắt buộc: 3/3" sat next to six unmet
// mode-specific requirements and the "Cần bổ sung" panel only appeared after a
// submit attempt. Denominator = every enforced field of the current mode.
describe('required completion — the whole form, live', () => {
  it('counts a pristine FCL catalog lot against every enforced field', () => {
    // 3 identity + 6 per container row (type, factory, route, ports, schedule).
    expect(completion(EMPTY_SHIPMENT_CREATE_FORM)).toEqual({ done: 0, total: 9 });
  });

  it('walks the chip math across fill states: empty → partial → all-identity → all-9 (QA1-007-COMPLETENESS-CHIP)', () => {
    // One denominator throughout: the full required set of the form shape.
    expect(completion(EMPTY_SHIPMENT_CREATE_FORM)).toEqual({ done: 0, total: 9 });
    expect(completion({ ...EMPTY_SHIPMENT_CREATE_FORM, customerId: '1' })).toEqual({ done: 1, total: 9 });
    expect(completion({
      ...EMPTY_SHIPMENT_CREATE_FORM,
      customerId: '1',
      tradeDirection: 'IMPORT',
    })).toEqual({ done: 2, total: 9 });
    expect(completion(IDENTITY_FILLED)).toEqual({ done: 3, total: 9 });
    expect(completion(IDENTITY_FILLED, [FULL_FCL_ROW])).toEqual({ done: 9, total: 9 });
  });

  it('reads 3/9 once only the three identity fields are filled (the repro)', () => {
    const form = IDENTITY_FILLED;
    const containers = [createEmptyContainer()];
    expect(completion(form, containers)).toEqual({ done: 3, total: 9 });
    // …and the panel has exactly six things left to name, not zero.
    expect(getShipmentCreateReadiness(form, containers).issues).toHaveLength(6);
  });

  it('counts LCL against its own fields, not the FCL container row', () => {
    // FB-105 (spec §2) made hàng lẻ carry its own operating points: route +
    // Nhà máy + Kho (CFS/Cảng) alongside 3 cargo fields and the delivery date,
    // so one-row FCL (9) and LCL (10) differ while a second FCL row diverges
    // by six more.
    const lcl = { ...IDENTITY_FILLED, cargoMode: 'LCL' as const };
    expect(completion(lcl, [createEmptyContainer()])).toEqual({ done: 3, total: 10 });
    const fclTwoRows = [createEmptyContainer(), createEmptyContainer()];
    expect(completion(IDENTITY_FILLED, fclTwoRows)).toEqual({ done: 3, total: 15 });
    expect(completion(lcl, fclTwoRows)).toEqual({ done: 3, total: 10 });
  });

  it('lowers the denominator exactly like the ad-hoc waivers (no impossible counts)', () => {
    // FCL ad-hoc waives factory/route/ports per row: 3 identity + type + schedule.
    const adHocFcl = { ...EMPTY_SHIPMENT_CREATE_FORM, isAdHoc: true };
    expect(completion(adHocFcl, [createEmptyContainer()])).toEqual({ done: 0, total: 5 });
    const adHocFclFilled = {
      ...IDENTITY_FILLED,
      isAdHoc: true,
      customerId: '',
      rawCustomerName: 'Khách vãng lai 8888',
    };
    expect(completion(adHocFclFilled, [createEmptyContainer()])).toEqual({ done: 3, total: 5 });

    // LCL ad-hoc also waives route + warehouse: 3 identity + 4 cargo/schedule.
    const adHocLcl = {
      ...IDENTITY_FILLED,
      isAdHoc: true,
      customerId: '',
      rawCustomerName: 'Khách vãng lai 8888',
      cargoMode: 'LCL' as const,
    };
    expect(completion(adHocLcl, [])).toEqual({ done: 3, total: 7 });
  });

  it('reaches N/N only when nothing blocks', () => {
    expect(completion(IDENTITY_FILLED, [FULL_FCL_ROW])).toEqual({ done: 9, total: 9 });
    expect(completion(FULL_LCL_FORM, [])).toEqual({ done: 10, total: 10 });
  });

  it('counts an entered-invalid optional CBM in the denominator instead of claiming done', () => {
    const invalidCbm = { ...FULL_LCL_FORM, cargoVolumeCbm: '0' };
    // The optional field is not a required slot, but shipping it still blocks:
    // 10 required done + 1 extra blocker.
    expect(completion(invalidCbm, [])).toEqual({ done: 10, total: 11 });
  });

  it('accepts typed text for the LCL operating points (FB-105)', () => {
    const typed = {
      ...FULL_LCL_FORM,
      operationalSiteId: '',
      routeId: '7',
      pickupWarehouseSiteId: '',
      factoryName: 'Nhà máy gõ tay',
      pickupWarehouseName: 'Kho gõ tay',
    };
    expect(completion(typed, [])).toEqual({ done: 10, total: 10 });
  });

  it('renders the shared denominator in the chip', () => {
    render(
      <ShipmentCreateTopline
        saving={null}
        requiredDone={3}
        requiredTotal={9}
        onCancel={vi.fn()}
        onSaveDraft={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText('3/9')).toBeTruthy();
  });
});

describe('SIL-481 view-mode topline (post-create review)', () => {
  const viewProps = {
    saving: null,
    requiredDone: 9,
    requiredTotal: 9,
    onCancel: vi.fn(),
    onSaveDraft: vi.fn(),
    onCreate: vi.fn(),
    onBack: vi.fn(),
    onEdit: vi.fn(),
  };

  it('titles the review, hides the fill-progress chip and swaps the cluster', () => {
    render(<ShipmentCreateTopline mode="view" {...viewProps} />);
    expect(screen.getByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    expect(screen.queryByText(/Bắt buộc:/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chuyển sang sửa' })).toBeTruthy();
    // No create/save affordance rides the read-only topline.
    expect(screen.queryByRole('button', { name: 'Tạo lô hàng' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lưu nháp' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Huỷ' })).toBeNull();
  });

  it('a viewer without the edit gate sees Quay lại alone', () => {
    render(<ShipmentCreateTopline mode="view" {...viewProps} onEdit={undefined} />);
    expect(screen.getByRole('button', { name: 'Quay lại' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chuyển sang sửa' })).toBeNull();
  });

  it('an accounting-locked lot disables Chuyển sang sửa with the reason', () => {
    render(<ShipmentCreateTopline mode="view" {...viewProps} editLocked />);
    const edit = screen.getByRole('button', { name: 'Chuyển sang sửa' });
    expect(edit.getAttribute('data-disabled')).toBe('true');
  });
});
