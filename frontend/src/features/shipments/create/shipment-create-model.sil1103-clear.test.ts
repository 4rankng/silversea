// SIL-1103 (K2.128) — QA repro (lot 1314, "Sửa lô hàng"): clearing NGÀY GIỜ
// ĐÓNG/TRẢ on an existing container row left the chip at "Bắt buộc: 8/9" and
// painted "Lỗi: Container 1: chọn ngày giờ đóng/trả" — the save never fired.
// The required rule is for NEW rows awaiting dispatch readiness; an EXISTING
// row (persisted id) clears lawfully (empty = chưa chốt lịch). Both the chip
// seat and the red inline row error derive from the single
// getShipmentCreateReadiness issue list, so one exemption must clear both —
// pinned here at the model level, plus the payload that must ride null.
import { describe, expect, it } from 'vitest';

import {
  EMPTY_SHIPMENT_CREATE_FORM,
  buildShipmentContainerPayload,
  getShipmentCreateReadiness,
  type ShipmentContainerDraft,
  type ShipmentCreateFormState,
} from './shipment-create-model';
import { requiredCompletion } from './ShipmentCreateTopline.progress';

const fclForm: ShipmentCreateFormState = {
  ...EMPTY_SHIPMENT_CREATE_FORM,
  customerId: '7',
  tradeDirection: 'IMPORT',
  blNumber: 'BL-SIL1103',
};

const datedRow: ShipmentContainerDraft = {
  key: 'c-1314',
  id: 1314,
  containerNumber: 'F2K288TEST01',
  containerTypeId: '31',
  routeId: '11',
  rawRouteName: '',
  pickupPortId: '21',
  dropoffPortId: '22',
  rawPickupPortName: '',
  rawDropoffPortName: '',
  cargoWeightKg: '12000',
  cargoVolumeCbm: '',
  operationalSiteId: '41',
  rawFactoryName: '',
  customerAppointmentAt: '2026-11-28T10:00',
  declarationNumber: '',
};

const appointmentIssues = (containers: ShipmentContainerDraft[]) => getShipmentCreateReadiness(fclForm, containers).issues
  .filter((item) => item.fieldId.endsWith('-customer-appointment'));

describe('SIL-1103 — an existing row may clear giờ đóng/trả', () => {
  it('a persisted row with a CLEARED appointment raises no issue — save unblocked, chip 8/8', () => {
    const clearedRow = { ...datedRow, customerAppointmentAt: '' };
    expect(appointmentIssues([clearedRow])).toEqual([]);
    expect(getShipmentCreateReadiness(fclForm, [clearedRow]).issues).toEqual([]);

    const chip = requiredCompletion(fclForm, [clearedRow], []);
    expect(chip).toEqual({ done: 8, total: 8 });
  });

  it('a NEW row (no persisted id) still requires the appointment — required law intact', () => {
    const newRow = { ...datedRow, key: 'row-new', id: undefined, containerNumber: '', customerAppointmentAt: '' };
    expect(appointmentIssues([newRow]).map((item) => item.fieldId)).toEqual(['container-row-new-customer-appointment']);
    expect(appointmentIssues([newRow]).map((item) => item.message)).toEqual(['Container 1: chọn ngày giờ đóng/trả.']);
    // 3 identity + 5 row seats done; the empty appointment slot stays undone.
    expect(requiredCompletion(fclForm, [newRow], appointmentIssues([newRow]))).toEqual({ done: 8, total: 9 });
  });

  it('the edit payload SENDS the clear: customerAppointmentAt null on the persisted row id', () => {
    const payload = buildShipmentContainerPayload(fclForm, [{ ...datedRow, customerAppointmentAt: '' }]);
    expect(payload).toEqual([expect.objectContaining({ id: 1314, customerAppointmentAt: null })]);
  });

  it('a re-dated existing row still sends the instant (no regression on the normal edit path)', () => {
    const payload = buildShipmentContainerPayload(fclForm, [datedRow]);
    expect(payload[0]?.customerAppointmentAt).toBe('2026-11-28T10:00:00+07:00');
  });
});
