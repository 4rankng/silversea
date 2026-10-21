/**
 * ENV-01 (doc khách 21/10, Frank gật) — the pure QA-fixture catalog for
 * `make stgqa`.
 *
 * FB-061 class law: every fixture row must live INSIDE the QA marker class
 * (`services/qa-fixture-markers.ts`), so the SAME signatures that keep
 * prod-mirror views clean also make `make qapurge` able to remove the set:
 *
 *   - view side: `listPhoiPhieuRows` and the other marker-filtered reads
 *     never list a row whose reference/name carries a QA token;
 *   - purge side: the `seed/qa-fixture-registry.ts` surfaces match the same
 *     tokens (shipments soft-delete, business_units hard-delete, sites
 *     scrub, containers hard-delete).
 *
 * Every code/name/reference below therefore starts with `QA`. The set is the
 * minimal world QA needs after a prod sync: one demo business unit, one demo
 * customer, one demo warehouse (nhà xe), and four sample lots covering FCL
 * import, FCL export, LCL, and a kẹp lot (two 20' containers on one trailer,
 * LoHangKepKetHop §1.1).
 *
 * PURE module — no db import, no Date.now/random: `buildStgqaFixtureSet()`
 * is deterministic, which is what makes the seed idempotent and the unit
 * tests able to pin the shape. The executor is `seed-qa-fixtures.ts`.
 */

/** Trade-direction literal (mirror of shipmentTradeDirectionEnum for purity). */
export type StgqaTradeDirection = 'IMPORT' | 'EXPORT';
/** Cargo-mode literal (mirror of shipmentCargoModeEnum for purity). */
export type StgqaCargoMode = 'FCL' | 'LCL';

export interface StgqaBusinessUnitFixture {
  /** Natural key (business_units.code, unique). */
  code: string;
  /** Unique name (business_units_name_uniq_idx). */
  name: string;
  status: 'ACTIVE';
}

export interface StgqaCustomerFixture {
  /** Natural key (customers.code — not DB-unique; seed discipline keeps one). */
  code: string;
  /** Matches the QA party-marker class (qaPartyMarkerSql → name ILIKE 'QA%'). */
  name: string;
  shortName: string;
  /** NULL on purpose: the active-name+taxcode unique index collapses NULL
   *  tax codes to '', and a fabricated tax code could collide with a real
   *  customer after a prod sync. */
  taxCode: null;
  address: string;
  contactPerson: string;
  phone: string;
}

export interface StgqaWarehouseFixture {
  /** Natural key (operational_sites unique (customer_id, code) among live rows). */
  code: string;
  name: string;
  shortName: string;
  siteType: 'WAREHOUSE';
  address: string;
  contactName: string;
  contactPhone: string;
}

export interface StgqaContainerFixture {
  containerNumber: string;
  /** Canonical container_types code resolved at seed time (20DC/40DC…). */
  containerTypeCode: string;
  sealNumber: string;
}

export interface StgqaShipmentFixture {
  /** Natural key (shipments.shipment_code, unique). */
  shipmentCode: string;
  tradeDirection: StgqaTradeDirection;
  cargoMode: StgqaCargoMode;
  /** Kẹp lot: two 20' containers share one trailer (PRD LoHangKepKetHop §1.1). */
  isCombined: boolean;
  /** Repo direction convention (shipments_document_reference_direction_check
   *  + prod data census 2026-10-21: EXPORT rows carry booking_ref, IMPORT rows
   *  carry bl_number). Never both. */
  bookingRef: string | null;
  blNumber: string | null;
  containers: StgqaContainerFixture[];
  factoryName: string;
  operationalNotes: string;
  status: 'PENDING_DATE';
  expectedDeliveryDate: string;
  packageCount: number;
  packageType: string;
  cargoWeightKg: string;
  contactName: string;
  contactPhone: string;
}

export interface StgqaFixtureSet {
  businessUnit: StgqaBusinessUnitFixture;
  customer: StgqaCustomerFixture;
  warehouse: StgqaWarehouseFixture;
  shipments: StgqaShipmentFixture[];
}

/** The demo business unit every fixture hangs off (responsible_unit_id). */
const BUSINESS_UNIT: StgqaBusinessUnitFixture = {
  code: 'QA-DEMO',
  name: 'QA Đơn vị dữ liệu mẫu',
  status: 'ACTIVE',
};

const CUSTOMER: StgqaCustomerFixture = {
  code: 'QAKH-DEMO',
  name: 'QA Khách hàng Demo',
  shortName: 'QA KH Demo',
  taxCode: null,
  address: 'QA địa chỉ demo — 123 Đường Mẫu, Quận 1, TP.HCM',
  contactPerson: 'QA Người liên hệ Demo',
  phone: '0900000001',
};

const WAREHOUSE: StgqaWarehouseFixture = {
  code: 'QAKHO-DEMO',
  name: 'QA Nhà xe Demo',
  shortName: 'QA Nhà xe',
  siteType: 'WAREHOUSE',
  address: 'QA địa chỉ nhà xe demo — Khu Mẫu, TP.HCM',
  contactName: 'QA Thủ kho Demo',
  contactPhone: '0900000002',
};

/** Shared text fields so every lot reads as one seeded family. */
const FACTORY_NAME = 'QA Nhà máy Demo';
const NOTES = 'QA-ENV01 fixture dữ liệu mẫu (make stgqa) — không phải lô thật';
const EXPECTED_DELIVERY_DATE = '2026-12-31';

function lot(values: {
  shipmentCode: string;
  tradeDirection: StgqaTradeDirection;
  cargoMode: StgqaCargoMode;
  isCombined?: boolean;
  containers?: StgqaContainerFixture[];
  cargoWeightKg: string;
}): StgqaShipmentFixture {
  const reference =
    values.tradeDirection === 'IMPORT'
      ? { bookingRef: null, blNumber: `QA-${values.shipmentCode}` }
      : { bookingRef: `QA-${values.shipmentCode}`, blNumber: null };
  return {
    shipmentCode: values.shipmentCode,
    tradeDirection: values.tradeDirection,
    cargoMode: values.cargoMode,
    isCombined: values.isCombined ?? false,
    ...reference,
    containers: values.containers ?? [],
    factoryName: FACTORY_NAME,
    operationalNotes: NOTES,
    status: 'PENDING_DATE',
    expectedDeliveryDate: EXPECTED_DELIVERY_DATE,
    packageCount: 10,
    packageType: 'Thùng carton',
    cargoWeightKg: values.cargoWeightKg,
    contactName: CUSTOMER.contactPerson,
    contactPhone: CUSTOMER.phone,
  };
}

/**
 * The deterministic fixture set. Four lots is the ENV-01 minimum: đủ loại
 * FCL/LCL/kẹp — FCL IMPORT, FCL EXPORT, LCL (hàng lẻ), và một lô kẹp hai
 * container 20'.
 */
export function buildStgqaFixtureSet(): StgqaFixtureSet {
  return {
    businessUnit: BUSINESS_UNIT,
    customer: CUSTOMER,
    warehouse: WAREHOUSE,
    shipments: [
      lot({
        shipmentCode: 'QAENV01-FCL-IMP',
        tradeDirection: 'IMPORT',
        cargoMode: 'FCL',
        containers: [
          { containerNumber: 'QATU0001231', containerTypeCode: '20DC', sealNumber: 'QASEAL0031' },
        ],
        cargoWeightKg: '8000.00',
      }),
      lot({
        shipmentCode: 'QAENV01-FCL-EXP',
        tradeDirection: 'EXPORT',
        cargoMode: 'FCL',
        containers: [
          { containerNumber: 'QATU0001232', containerTypeCode: '40DC', sealNumber: 'QASEAL0032' },
        ],
        cargoWeightKg: '12000.00',
      }),
      lot({
        shipmentCode: 'QAENV01-LCL',
        tradeDirection: 'IMPORT',
        cargoMode: 'LCL',
        cargoWeightKg: '2500.00',
      }),
      lot({
        shipmentCode: 'QAENV01-FCL-KEP',
        tradeDirection: 'IMPORT',
        cargoMode: 'FCL',
        isCombined: true,
        // Kẹp = hai container 20FT chạy đồng thời (PRD §1.1): one loaded,
        // one empty — the common case.
        containers: [
          { containerNumber: 'QATU0001233', containerTypeCode: '20DC', sealNumber: 'QASEAL0033' },
          { containerNumber: 'QATU0001234', containerTypeCode: '20DC', sealNumber: 'QASEAL0034' },
        ],
        cargoWeightKg: '15000.00',
      }),
    ],
  };
}
