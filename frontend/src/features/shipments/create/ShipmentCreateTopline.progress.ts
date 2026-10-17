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
 *   Lệnh chạy ngoài waivers the validator applies (ad-hoc lots waive the
 *   catalog prerequisites, so counting them would invent impossible work);
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
  | 'packageType'
  | 'packageCount'
  | 'cargoWeightKg'
  | 'expectedDeliveryDate'
>;

type RequiredRow = Pick<
  ShipmentContainerDraft,
  | 'key'
  | 'containerTypeId'
  | 'operationalSiteId'
  | 'routeId'
  | 'pickupPortId'
  | 'dropoffPortId'
  | 'customerAppointmentAt'
>;

export interface RequiredSlot {
  fieldId: string;
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
      done: Boolean(form.customerId) || (form.isAdHoc && Boolean(form.rawCustomerName.trim())),
    },
    { fieldId: 'shipment-trade-direction', done: Boolean(form.tradeDirection) },
    {
      // Direction picks the reference: Nhập needs a Bill, Xuất a Booking.
      fieldId: 'shipment-booking-ref',
      done: form.tradeDirection === 'IMPORT'
        ? Boolean(form.blNumber)
        : form.tradeDirection === 'EXPORT'
          ? Boolean(form.bookingRef)
          : false,
    },
  ];

  if (form.cargoMode === 'FCL') {
    for (const row of containers) {
      const prefix = `container-${row.key}`;
      slots.push({ fieldId: `${prefix}-type`, done: Boolean(row.containerTypeId) });
      // Catalog prerequisites are waived for Lệnh chạy ngoài (MasterDataNhaMay
      // §4.1), matching the `!adHoc` guards in the validator.
      if (!form.isAdHoc) {
        slots.push({ fieldId: `${prefix}-factory`, done: Boolean(row.operationalSiteId) });
        slots.push({ fieldId: `${prefix}-route`, done: Boolean(row.routeId) });
        slots.push({ fieldId: `${prefix}-pickup-port`, done: Boolean(row.pickupPortId) });
        slots.push({ fieldId: `${prefix}-dropoff-port`, done: Boolean(row.dropoffPortId) });
      }
      slots.push({
        fieldId: `${prefix}-customer-appointment`,
        done: Boolean(row.customerAppointmentAt),
      });
    }
    return slots;
  }

  if (!form.isAdHoc) {
    // Route + the lot's two operating points (Nhà máy, Kho CFS/Cảng) all come
    // from the customer's catalog or ad-hoc-typed text; Lệnh chạy ngoài waives
    // the catalog prerequisites, so an ad-hoc lot carries none of them.
    slots.push({ fieldId: 'shipment-route', done: Boolean(form.routeId) });
    // FB-105 (spec §2): both operating points accept a catalog pick OR typed
    // text, so the slot is done when either channel holds a value.
    slots.push({
      fieldId: 'shipment-operational-site',
      done: Boolean(form.operationalSiteId) || Boolean(form.factoryName.trim()),
    });
    slots.push({
      fieldId: 'shipment-pickup-warehouse',
      done: Boolean(form.pickupWarehouseSiteId) || Boolean(form.pickupWarehouseName.trim()),
    });
  }
  slots.push({ fieldId: 'shipment-package-type', done: Boolean(form.packageType) });
  slots.push({
    fieldId: 'shipment-package-count',
    done: Boolean(form.packageCount) && Number(form.packageCount) >= 1,
  });
  slots.push({
    fieldId: 'shipment-cargo-weight',
    done: Boolean(form.cargoWeightKg) && Number(form.cargoWeightKg) > 0,
  });
  // CBM is deliberately absent: helpdesk 2026-10-13 made it optional, and an
  // optional field must never raise the denominator.
  slots.push({
    fieldId: 'shipment-expected-delivery',
    done: Boolean(form.expectedDeliveryDate),
  });
  return slots;
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
