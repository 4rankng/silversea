import type {
  ShipmentContainerDraft,
  ShipmentCreateFormState,
  ShipmentCreateIssue,
} from './shipment-create-model';

/**
 * Card 171026113510 (QA1-007, verify-fail lần 2): the "Bắt buộc" chip counted
 * only the three `*`-marked identity fields, so a lot with customer + hình thức
 * + số Bill read "3/3" — finished — while six mode-specific requirements still
 * blocked "Tạo lô hàng". The panel that should have named them was wired to
 * `validationIssues`, which `runSave` only fills AFTER a submit attempt: before
 * the first click there was nothing to list.
 *
 * Both now derive from the live shape of the whole form:
 *
 * - the required set is enumerated per mode / per container row, with the same
 *   Lệnh chạy ngoài waivers the validator applies — exactly Nhà máy + Tuyến
 *   đường chuẩn (KB K3.23 §3.2.3, SIL-965); the ports stay counted because the
 *   waiver never covers them and the typed raw name keeps them fillable;
 * - a slot is done when its own predicate says so AND the validator reports no
 *   issue for it (the issue list is the authority whenever it has an opinion —
 *   it skips the document-reference slot until a direction is chosen, and that
 *   silence must not read as "done");
 * - blocking checks outside the required set (today: an entered-invalid
 *   optional LCL CBM) still join the denominator, so the chip can never say
 *   "done" next to a non-empty panel.
 */

type RequiredForm = Pick<
  ShipmentCreateFormState,
  | 'isAdHoc'
  | 'cargoMode'
  | 'customerId'
  | 'rawCustomerName'
  | 'tradeDirection'
  | 'blNumber'
  | 'bookingRef'
  | 'routeId'
  | 'operationalSiteId'
  | 'pickupWarehouseSiteId'
  | 'factoryName'
  | 'pickupWarehouseName'
  | 'packageCount'
  | 'packageType'
  | 'cargoWeightKg'
  | 'expectedDeliveryDate'
  | 'lclClosingAt'
>;

type RequiredRow = Pick<
  ShipmentContainerDraft,
  | 'key'
  | 'id'
  | 'containerTypeId'
  | 'operationalSiteId'
  | 'routeId'
  | 'pickupPortId'
  | 'dropoffPortId'
  | 'rawPickupPortName'
  | 'rawDropoffPortName'
  | 'customerAppointmentAt'
>;

export interface RequiredSlot {
  fieldId: string;
  /** SIL-1145 (QA-Retest4): the form label the field's star rides — the
   *  missing-fields hint beside the "Bắt buộc" chip names exactly these. */
  label: string;
  done: boolean;
}

/**
 * Every field the CREATE validator enforces for this form shape, each with its
 * satisfied flag. Field ids mirror `getShipmentCreateReadiness` exactly, so the
 * chip, the panel and the field paint all name the same thing.
 */
export function requiredSlots(
  form: RequiredForm,
  containers: ReadonlyArray<RequiredRow>,
): RequiredSlot[] {
  const slots: RequiredSlot[] = [
    {
      fieldId: 'shipment-customer',
      label: 'Khách hàng',
      done: Boolean(form.customerId) || (form.isAdHoc && Boolean(form.rawCustomerName.trim())),
    },
    { fieldId: 'shipment-trade-direction', label: 'Hình thức xuất nhập khẩu', done: Boolean(form.tradeDirection) },
    {
      // Direction picks the reference: Nhập needs a Bill, Xuất a Booking.
      fieldId: 'shipment-booking-ref',
      label: 'Số Bill/Booking',
      done: form.tradeDirection === 'IMPORT'
        ? Boolean(form.blNumber)
        : form.tradeDirection === 'EXPORT'
          ? Boolean(form.bookingRef)
          : false,
    },
  ];

  if (form.cargoMode === 'FCL') {
    for (const [index, row] of containers.entries()) {
      const prefix = `container-${row.key}`;
      // Row context rides the label the same way the validator's issues do
      // ("Container 2: chọn cảng nâng.") — a multi-cont lot names the row.
      const rowLabel = `Container ${index + 1}`;
      slots.push({ fieldId: `${prefix}-type`, label: `${rowLabel}: Loại container`, done: Boolean(row.containerTypeId) });
      // KB K3.23 §3.2.3 (SIL-965): Lệnh chạy ngoài waives exactly Nhà máy +
      // Tuyến đường chuẩn — matching the `!adHoc` guards in the validator.
      if (!form.isAdHoc) {
        slots.push({ fieldId: `${prefix}-factory`, label: `${rowLabel}: Nhà máy`, done: Boolean(row.operationalSiteId) });
        slots.push({ fieldId: `${prefix}-route`, label: `${rowLabel}: Tuyến đường`, done: Boolean(row.routeId) });
      }
      // The ports stay required for an ad-hoc row too; the typed raw name is
      // the second satisfying channel (XOR with the catalog id).
      slots.push({
        fieldId: `${prefix}-pickup-port`,
        label: `${rowLabel}: Cảng nâng`,
        done: Boolean(row.pickupPortId) || (form.isAdHoc && Boolean(row.rawPickupPortName.trim())),
      });
      slots.push({
        fieldId: `${prefix}-dropoff-port`,
        label: `${rowLabel}: Cảng hạ`,
        done: Boolean(row.dropoffPortId) || (form.isAdHoc && Boolean(row.rawDropoffPortName.trim())),
      });
      // SIL-1103 (K2.128): the schedule seat exists only for rows the
      // reconcile will CREATE — an EXISTING row (persisted id) may clear its
      // giờ đóng/trả (empty = chưa chốt lịch) without raising the
      // denominator or blocking the save, mirroring the validator.
      if (row.id == null) {
        slots.push({
          fieldId: `${prefix}-customer-appointment`,
          label: `${rowLabel}: Ngày giờ đóng trả`,
          done: Boolean(row.customerAppointmentAt),
        });
      }
    }
    return slots;
  }

  if (!form.isAdHoc) {
    // Route + the lot's two operating points (Nhà máy, Kho CFS/Cảng) all come
    // from the customer's catalog or ad-hoc-typed text; Lệnh chạy ngoài waives
    // the catalog prerequisites, so an ad-hoc lot carries none of them.
    slots.push({ fieldId: 'shipment-route', label: 'Tuyến đường', done: Boolean(form.routeId) });
    // FB-105 (spec §2): both operating points accept a catalog pick OR typed
    // text, so the slot is done when either channel holds a value.
    slots.push({
      fieldId: 'shipment-operational-site',
      label: 'Nhà máy',
      done: Boolean(form.operationalSiteId) || Boolean(form.factoryName.trim()),
    });
    slots.push({
      fieldId: 'shipment-pickup-warehouse',
      // The label mirrors the field's direction-correct star label (KB
      // §3.2.4); the un-picked direction reads the base name.
      label: form.tradeDirection === 'EXPORT'
        ? 'Kho trả hàng (CFS/Cảng)'
        : form.tradeDirection === 'IMPORT'
          ? 'Kho lấy hàng (CFS/Cảng)'
          : 'Kho lấy hàng',
      done: Boolean(form.pickupWarehouseSiteId) || Boolean(form.pickupWarehouseName.trim()),
    });
  }
  // SIL-917 (KB §3.2.3, audit 24/11): the Hàng lẻ chip denominator is 10 —
  // the KB's own sample table names Quy cách đóng gói's slot in it (the field
  // that carried the 10th seat before SIL-846). The VALIDATOR keeps quy cách
  // optional (KB §3.2.4/§7.3: no *, blank still saves — SIL-846 customer
  // ruling), so this slot is CHIP-ONLY: filling it moves the meter, leaving
  // it blank never blocks the save. CBM stays deliberately uncounted
  // ("CBM cố ý KHÔNG đếm", KB §3.2.3) and the trọng tải pick stays out too.
  // SIL-965 (KB K3.23 §3.2.3 "Lệnh chạy ngoài: 3/7 / miễn điều kiện danh
  // mục"): the ad-hoc exemption covers the CATALOG conditions only — Nhà máy
  // (điểm vận hành) + Tuyến đường chuẩn/Bảng giá — so this chip-only seat
  // STAYS counted when the toggle is on and the ad-hoc denominator lands on
  // 7 in BOTH modes (FCL 9−2, hàng lẻ 10−3).
  slots.push({
    fieldId: 'shipment-package-type',
    label: 'Quy cách đóng gói',
    done: Boolean(form.packageType.trim()),
  });
  // The validator still treats quy cách as a SUGGESTION (no gate, no *,
  // SIL-846) — see the chip-only slot above. The SIL-846 'Trọng tải (Loại xe
  // tính cước)' pick is optional too (Bảng giá basis, settled later if
  // blank) and never enters the denominator.
  slots.push({
    fieldId: 'shipment-package-count',
    label: 'Số lượng',
    done: Boolean(form.packageCount) && Number(form.packageCount) >= 1,
  });
  slots.push({
    fieldId: 'shipment-cargo-weight',
    label: 'Trọng lượng (tấn)',
    done: Boolean(form.cargoWeightKg) && Number(form.cargoWeightKg) > 0,
  });
  // CBM is deliberately absent: helpdesk 2026-10-13 made it optional, and an
  // optional field must never raise the denominator.
  slots.push({
    // SIL-587: the LCL schedule slot is the "Ngày giờ đóng trả" datetime; a
    // stored EDD (edit-prefilled legacy lot) satisfies the requirement the
    // same way the validator accepts it.
    fieldId: 'shipment-lcl-closing-at',
    label: 'Ngày giờ đóng trả',
    done: Boolean(form.lclClosingAt) || Boolean(form.expectedDeliveryDate),
  });
  return slots;
}

/**
 * SIL-1145 (QA-Retest4): the missing required field labels, in slot order —
 * what the "Còn thiếu" hint beside the "Bắt buộc" chip names when the meter
 * sits below its total. The labels are the same ones the stars ride
 * (requiredSlots), so the hint always points at fields visible on the form.
 */
export function missingRequiredLabels(
  form: RequiredForm,
  containers: ReadonlyArray<RequiredRow>,
): string[] {
  return requiredSlots(form, containers)
    .filter((slot) => !slot.done)
    .map((slot) => slot.label);
}

export interface RequiredCompletion {
  done: number;
  total: number;
}

/** One denominator for the chip and the "Cần bổ sung N thông tin" panel. */
export function requiredCompletion(
  form: RequiredForm,
  containers: ReadonlyArray<RequiredRow>,
  issues: ReadonlyArray<Pick<ShipmentCreateIssue, 'fieldId'>>,
): RequiredCompletion {
  const slots = requiredSlots(form, containers);
  const requiredIds = new Set(slots.map((slot) => slot.fieldId));
  const issueIds = new Set(issues.map((item) => item.fieldId));
  const done = slots.filter((slot) => slot.done && !issueIds.has(slot.fieldId)).length;
  const extraBlockers = issues.filter((item) => !requiredIds.has(item.fieldId)).length;
  return { done, total: slots.length + extraBlockers };
}
