import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
    // Nhà máy + Kho (CFS/Cảng) alongside the cargo fields and the delivery
    // date, so one-row FCL (9) and LCL differ from a second FCL row (15).
    // SIL-917 (KB §3.2.3, audit 24/11): the Hàng lẻ sample denominator is 10
    // — the chip re-counts the Quy cách đóng gói slot (chip-only; the
    // validator keeps it optional per SIL-846). CBM stays uncounted.
    const lcl = { ...IDENTITY_FILLED, cargoMode: 'LCL' as const };
    expect(completion(lcl, [createEmptyContainer()])).toEqual({ done: 3, total: 10 });
    const fclTwoRows = [createEmptyContainer(), createEmptyContainer()];
    expect(completion(IDENTITY_FILLED, fclTwoRows)).toEqual({ done: 3, total: 15 });
    expect(completion(lcl, fclTwoRows)).toEqual({ done: 3, total: 10 });
  });

  it('lowers the denominator exactly like the ad-hoc waivers (no impossible counts)', () => {
    // KB K3.23 §3.2.3 (SIL-965): ad-hoc waives exactly factory + route per
    // row — the ports stay: 3 identity + type + 2 ports + schedule.
    const adHocFcl = { ...EMPTY_SHIPMENT_CREATE_FORM, isAdHoc: true };
    expect(completion(adHocFcl, [createEmptyContainer()])).toEqual({ done: 0, total: 7 });
    const adHocFclFilled = {
      ...IDENTITY_FILLED,
      isAdHoc: true,
      customerId: '',
      rawCustomerName: 'Khách vãng lai 8888',
    };
    expect(completion(adHocFclFilled, [createEmptyContainer()])).toEqual({ done: 3, total: 7 });

    // LCL ad-hoc also waives route + warehouse: 3 identity + 3 cargo/schedule
    // (SIL-846 dropped the quy cách slot).
    const adHocLcl = {
      ...IDENTITY_FILLED,
      isAdHoc: true,
      customerId: '',
      rawCustomerName: 'Khách vãng lai 8888',
      cargoMode: 'LCL' as const,
    };
    expect(completion(adHocLcl, [])).toEqual({ done: 3, total: 6 });
  });

  it('reaches N/N only when nothing blocks', () => {
    expect(completion(IDENTITY_FILLED, [FULL_FCL_ROW])).toEqual({ done: 9, total: 9 });
    // SIL-917 (KB §3.2.3): the LCL sample denominator is 10 again — the
    // chip-only quy cách slot closes the meter once the optional field is
    // filled, and the validator never raises an issue for it (blank still
    // saves, SIL-846).
    expect(completion(FULL_LCL_FORM, [])).toEqual({ done: 10, total: 10 });
    expect(getShipmentCreateReadiness(FULL_LCL_FORM, []).issues).toEqual([]);
    // Blank quy cách leaves the meter at 9/10 without blocking the save.
    const noPackageType = { ...FULL_LCL_FORM, packageType: '' };
    expect(completion(noPackageType, [])).toEqual({ done: 9, total: 10 });
    expect(getShipmentCreateReadiness(noPackageType, []).issues).toEqual([]);
  });

  it('counts an entered-invalid optional CBM in the denominator instead of claiming done', () => {
    // SIL-719 (id 839): 0 is a LEGAL volume ("không có thể tích"), so the
    // optional field is no longer a blocker at 0 — only a negative one is.
    const zeroCbm = { ...FULL_LCL_FORM, cargoVolumeCbm: '0' };
    expect(completion(zeroCbm, [])).toEqual({ done: 10, total: 10 });

    // A negative volume still blocks — and it is counted, not silently
    // dropped: the issue rides OUTSIDE the slot list, so it extends the
    // denominator instead of stealing a done seat.
    const negativeCbm = { ...FULL_LCL_FORM, cargoVolumeCbm: '-1' };
    expect(completion(negativeCbm, [])).toEqual({ done: 10, total: 11 });
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
    render(<ShipmentCreateTopline requiredDone={3} requiredTotal={9} />);
    expect(screen.getByText('3/9')).toBeTruthy();
  });
});

describe('SIL-481 view-mode topline (post-create review)', () => {
  it('titles the review, hides the fill-progress chip and carries no action bar', () => {
    render(<ShipmentCreateTopline mode="view" requiredDone={9} requiredTotal={9} />);
    expect(screen.getByRole('heading', { name: 'Chi tiết lô hàng' })).toBeTruthy();
    expect(screen.queryByText(/Bắt buộc:/)).toBeNull();
    // SIL-510 (owner 26/10): the topline retired its action twin — the ONE
    // action bar of the worksheet is the viewport-fixed footer, so the
    // review cluster (Quay lại / Sửa / Tạo mới lô hàng) renders only there.
    // The gating behaviors the old topline buttons carried (role-refused
    // degradation, the accounting-locked disabled Sửa) stay covered at the
    // workspace level in ShipmentCreateWorkspace.view-mode.test.tsx.
    expect(document.querySelector('.csc-topline')!.querySelectorAll('button')).toHaveLength(0);
  });
});
