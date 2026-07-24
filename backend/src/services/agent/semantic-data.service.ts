import { TIRE_STATUS_LABELS, type TireStatus } from '@tingting/shared';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '../../db';

export const SEMANTIC_ENTITIES = [
  'trips',
  'tires',
  'trucks',
  'trailers',
  'drivers',
  'customers',
  'suppliers',
  'expenses',
  'ledger',
  'penalties',
  'debitNoteTemplates',
  'auditLogs',
  'companyInfo',
] as const;

export type SemanticEntity = (typeof SEMANTIC_ENTITIES)[number];

export interface SemanticEntityMeta {
  entity: SemanticEntity;
  title: string;
  description: string;
  searchableFields: string[];
  listFields: string[];
  detailFields: string[];
  filterFields: string[];
  aggregateMetrics: string[];
  timelineFields: string[];
}

export interface SemanticQuery {
  entity: SemanticEntity;
  search?: string;
  filters?: Record<string, string | number | boolean | null | undefined>;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface SemanticAggregateQuery extends SemanticQuery {
  metric: string;
  groupBy?: string;
}

type FieldType = 'string' | 'number' | 'boolean' | 'date';

interface FieldDef {
  expr: SQL;
  type: FieldType;
}

interface EntityDef {
  meta: SemanticEntityMeta;
  from: SQL;
  fields: Record<string, FieldDef>;
  defaultOrder: SQL;
  softDeleteSql?: SQL;
  dateField?: string;
}

const MAX_LIST_LIMIT = 100;
const MAX_SEARCH_PER_ENTITY = 8;

const text = (expr: SQL): FieldDef => ({ expr, type: 'string' });
const number = (expr: SQL): FieldDef => ({ expr, type: 'number' });
const bool = (expr: SQL): FieldDef => ({ expr, type: 'boolean' });
const date = (expr: SQL): FieldDef => ({ expr, type: 'date' });

const ENTITIES: Record<SemanticEntity, EntityDef> = {
  trips: {
    meta: {
      entity: 'trips',
      title: 'Chuyến xe',
      description: 'Lệnh vận chuyển, trạng thái chuyến, khách hàng, xe, tài xế, tuyến, doanh thu và chi phí.',
      searchableFields: ['tripCode', 'customerName', 'truckPlate', 'driverName', 'routeName', 'customerReference'],
      listFields: ['id', 'tripCode', 'departureDate', 'status', 'customerName', 'truckPlate', 'driverName', 'routeName', 'revenue', 'totalCost', 'grossProfit'],
      detailFields: ['id', 'tripCode', 'departureDate', 'status', 'customerName', 'customerReference', 'truckPlate', 'trailerPlate', 'driverName', 'routeName', 'cargoTypeName', 'fuelMode', 'fuelLiters', 'totalFuelCost', 'totalRoadAllowance', 'driverSalary', 'revenue', 'totalCost', 'grossProfit', 'notes', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'status', 'customerId', 'truckId', 'driverId', 'routeId', 'departureDate'],
      aggregateMetrics: ['count', 'fuelLiters'],
      timelineFields: ['createdAt', 'updatedAt', 'completedAt'],
    },
    from: sql`trips t
      LEFT JOIN customers c ON c.id = t.customer_id
      LEFT JOIN trucks tr ON tr.id = t.truck_id
      LEFT JOIN trailers tl ON tl.id = t.trailer_id
      LEFT JOIN drivers d ON d.id = t.driver_id
      LEFT JOIN routes r ON r.id = t.route_id
      LEFT JOIN cargo_types ct ON ct.id = t.cargo_type_id`,
    fields: {
      id: number(sql`t.id`),
      tripCode: text(sql`t.trip_code`),
      departureDate: date(sql`t.departure_date`),
      status: text(sql`t.status`),
      customerId: number(sql`t.customer_id`),
      customerName: text(sql`c.name`),
      customerReference: text(sql`t.customer_reference`),
      truckId: number(sql`t.truck_id`),
      truckPlate: text(sql`tr.license_plate`),
      trailerId: number(sql`t.trailer_id`),
      trailerPlate: text(sql`tl.license_plate`),
      driverId: number(sql`t.driver_id`),
      driverName: text(sql`d.name`),
      routeId: number(sql`t.route_id`),
      routeName: text(sql`r.name`),
      cargoTypeName: text(sql`ct.name`),
      fuelMode: text(sql`t.fuel_mode`),
      fuelLiters: number(sql`t.fuel_liters`),
      totalFuelCost: number(sql`t.total_fuel_cost`),
      totalRoadAllowance: number(sql`t.total_road_allowance`),
      driverSalary: number(sql`t.driver_salary`),
      revenue: number(sql`t.revenue`),
      totalCost: number(sql`t.total_cost`),
      grossProfit: number(sql`t.gross_profit`),
      notes: text(sql`t.notes`),
      completedAt: date(sql`t.completed_at`),
      createdAt: date(sql`t.created_at`),
      updatedAt: date(sql`t.updated_at`),
    },
    dateField: 'departureDate',
    softDeleteSql: sql`t.deleted_at IS NULL`,
    defaultOrder: sql`t.departure_date DESC, t.id DESC`,
  },
  tires: {
    meta: {
      entity: 'tires',
      title: 'Lốp',
      description: 'Lốp theo serial, vị trí lắp, tuổi lốp, nhà cung cấp, xe/rơ-moóc đang lắp, trạng thái thanh lý.',
      searchableFields: ['serial', 'truckPlate', 'trailerPlate', 'supplierName', 'position', 'size'],
      listFields: ['id', 'serial', 'status', 'statusLabel', 'position', 'size', 'vehiclePlate', 'locationLabel', 'supplierName', 'purchasedAt', 'tireAgeDays', 'disposalReason'],
      detailFields: ['id', 'serial', 'status', 'statusLabel', 'position', 'size', 'installedAt', 'removedAt', 'purchasedAt', 'tireAgeDays', 'supplierName', 'cost', 'truckPlate', 'trailerPlate', 'vehicleType', 'vehiclePlate', 'locationLabel', 'disposalDate', 'disposalReason', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'serial', 'status', 'truckId', 'trailerId', 'supplierId', 'vehiclePlate'],
      aggregateMetrics: ['count', 'cost'],
      timelineFields: ['installedAt', 'removedAt', 'disposalDate', 'createdAt', 'updatedAt'],
    },
    from: sql`tires tire
      LEFT JOIN trucks tr ON tr.id = tire.truck_id
      LEFT JOIN trailers tl ON tl.id = tire.trailer_id
      LEFT JOIN suppliers sup ON sup.id = tire.supplier_id`,
    fields: {
      id: number(sql`tire.id`),
      serial: text(sql`tire.serial`),
      status: text(sql`tire.status`),
      statusLabel: text(sql`CASE tire.status WHEN 'IN_STOCK' THEN 'Dự phòng' WHEN 'IN_USE' THEN 'Đang dùng' WHEN 'DISPOSED' THEN 'Đã thanh lý' ELSE COALESCE(tire.status, 'Không rõ trạng thái') END`),
      position: text(sql`tire.position`),
      size: text(sql`tire.size`),
      installedAt: date(sql`tire.installed_at`),
      removedAt: date(sql`tire.removed_at`),
      purchasedAt: date(sql`tire.purchased_at`),
      tireAgeDays: number(sql`CASE WHEN tire.purchased_at IS NULL THEN NULL ELSE GREATEST(0, CURRENT_DATE - tire.purchased_at) END`),
      supplierId: number(sql`tire.supplier_id`),
      supplierName: text(sql`sup.name`),
      cost: number(sql`tire.cost`),
      truckId: number(sql`tire.truck_id`),
      truckPlate: text(sql`tr.license_plate`),
      trailerId: number(sql`tire.trailer_id`),
      trailerPlate: text(sql`tl.license_plate`),
      vehicleType: text(sql`CASE WHEN tr.license_plate IS NOT NULL THEN 'TRUCK' WHEN tl.license_plate IS NOT NULL THEN 'TRAILER' ELSE 'STOCK' END`),
      vehiclePlate: text(sql`COALESCE(tr.license_plate, tl.license_plate)`),
      locationLabel: text(sql`CASE WHEN tr.license_plate IS NOT NULL THEN 'Xe đầu kéo ' || tr.license_plate WHEN tl.license_plate IS NOT NULL THEN 'Rơ-moóc ' || tl.license_plate WHEN tire.status = 'DISPOSED' THEN 'Đã thanh lý' ELSE 'Kho lốp dự phòng' END`),
      disposalDate: date(sql`tire.disposal_date`),
      disposalReason: text(sql`tire.disposal_reason`),
      createdAt: date(sql`tire.created_at`),
      updatedAt: date(sql`tire.updated_at`),
    },
    dateField: 'purchasedAt',
    softDeleteSql: sql`tire.deleted_at IS NULL`,
    defaultOrder: sql`tire.updated_at DESC, tire.id DESC`,
  },
  trucks: {
    meta: {
      entity: 'trucks',
      title: 'Xe đầu kéo',
      description: 'Đầu kéo, biển số, rơ-moóc hiện tại, đăng kiểm, bảo hiểm và trạng thái.',
      searchableFields: ['licensePlate', 'trailerPlateNumber', 'currentTrailerPlate'],
      listFields: ['id', 'licensePlate', 'status', 'trailerType', 'currentTrailerPlate', 'nextInspectionDate', 'insuranceExpiryDate'],
      detailFields: ['id', 'licensePlate', 'status', 'trailerType', 'currentTrailerId', 'currentTrailerPlate', 'nextInspectionDate', 'insuranceExpiryDate', 'lastOilServiceDate', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'status', 'licensePlate'],
      aggregateMetrics: ['count'],
      timelineFields: ['nextInspectionDate', 'insuranceExpiryDate', 'lastOilServiceDate', 'createdAt', 'updatedAt'],
    },
    from: sql`trucks tr LEFT JOIN trailers tl ON tl.id = tr.current_trailer_id`,
    fields: {
      id: number(sql`tr.id`),
      licensePlate: text(sql`tr.license_plate`),
      trailerPlateNumber: text(sql`tr.trailer_plate_number`),
      currentTrailerId: number(sql`tr.current_trailer_id`),
      currentTrailerPlate: text(sql`tl.license_plate`),
      trailerType: text(sql`tr.trailer_type`),
      status: text(sql`tr.status`),
      nextInspectionDate: date(sql`tr.next_inspection_date`),
      insuranceExpiryDate: date(sql`tr.insurance_expiry_date`),
      lastOilServiceDate: date(sql`tr.last_oil_service_date`),
      createdAt: date(sql`tr.created_at`),
      updatedAt: date(sql`tr.updated_at`),
    },
    softDeleteSql: sql`tr.deleted_at IS NULL`,
    defaultOrder: sql`tr.license_plate ASC`,
  },
  trailers: {
    meta: {
      entity: 'trailers',
      title: 'Rơ-moóc',
      description: 'Rơ-moóc theo biển số, loại 20/40ft và trạng thái.',
      searchableFields: ['licensePlate', 'type'],
      listFields: ['id', 'licensePlate', 'type', 'status'],
      detailFields: ['id', 'licensePlate', 'type', 'status', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'status', 'type', 'licensePlate'],
      aggregateMetrics: ['count'],
      timelineFields: ['createdAt', 'updatedAt'],
    },
    from: sql`trailers tl`,
    fields: {
      id: number(sql`tl.id`),
      licensePlate: text(sql`tl.license_plate`),
      type: text(sql`tl.type`),
      status: text(sql`tl.status`),
      createdAt: date(sql`tl.created_at`),
      updatedAt: date(sql`tl.updated_at`),
    },
    softDeleteSql: sql`tl.deleted_at IS NULL`,
    defaultOrder: sql`tl.license_plate ASC`,
  },
  drivers: {
    meta: {
      entity: 'drivers',
      title: 'Tài xế',
      description: 'Tài xế, điện thoại, xe được phân công, lương cơ bản và trạng thái.',
      searchableFields: ['name', 'phone', 'assignedTruckPlate'],
      listFields: ['id', 'name', 'phone', 'assignedTruckPlate', 'baseSalary', 'status'],
      detailFields: ['id', 'name', 'phone', 'assignedTruckId', 'assignedTruckPlate', 'baseSalary', 'socialInsurance', 'status', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'status', 'assignedTruckId'],
      // baseSalary is a per-driver RATE, not an additive total — SUM(baseSalary)
      // has no business meaning (real payroll is computeAllDriverSalaries via
      // report.run, which applies attendance/multipliers). Exposed only as a
      // detail/list field, never aggregatable.
      aggregateMetrics: ['count'],
      timelineFields: ['createdAt', 'updatedAt'],
    },
    from: sql`drivers d LEFT JOIN trucks tr ON tr.id = d.assigned_truck_id`,
    fields: {
      id: number(sql`d.id`),
      name: text(sql`d.name`),
      phone: text(sql`d.phone`),
      assignedTruckId: number(sql`d.assigned_truck_id`),
      assignedTruckPlate: text(sql`tr.license_plate`),
      baseSalary: number(sql`d.base_salary`),
      socialInsurance: number(sql`d.social_insurance`),
      status: text(sql`d.status`),
      createdAt: date(sql`d.created_at`),
      updatedAt: date(sql`d.updated_at`),
    },
    softDeleteSql: sql`d.deleted_at IS NULL`,
    defaultOrder: sql`d.name ASC`,
  },
  customers: {
    meta: {
      entity: 'customers',
      title: 'Khách hàng',
      description: 'Khách hàng, mã số thuế, liên hệ, hạn mức công nợ, mẫu giấy báo nợ và liên kết nhà cung cấp.',
      searchableFields: ['name', 'taxCode', 'contactPerson', 'phone'],
      listFields: ['id', 'name', 'taxCode', 'phone', 'creditLimit', 'status', 'debitNoteMode'],
      detailFields: ['id', 'name', 'taxCode', 'contactPerson', 'phone', 'contactInfo', 'creditLimit', 'status', 'isCarrier', 'debitNoteMode', 'debitNoteTemplateName', 'linkedSupplierName', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'status', 'isCarrier', 'debitNoteMode'],
      // creditLimit is a per-customer CAP, not an additive total — SUM(creditLimit)
      // is meaningless (total exposure is receivables, via report.run). Exposed
      // only as a detail/list field, never aggregatable.
      aggregateMetrics: ['count'],
      timelineFields: ['createdAt', 'updatedAt'],
    },
    from: sql`customers c
      LEFT JOIN debit_note_templates dnt ON dnt.id = c.debit_note_template_id
      LEFT JOIN suppliers sup ON sup.id = c.linked_supplier_id`,
    fields: {
      id: number(sql`c.id`),
      name: text(sql`c.name`),
      taxCode: text(sql`c.tax_code`),
      contactPerson: text(sql`c.contact_person`),
      phone: text(sql`c.phone`),
      contactInfo: text(sql`c.contact_info`),
      creditLimit: number(sql`c.credit_limit`),
      status: text(sql`c.status`),
      isCarrier: bool(sql`c.is_carrier`),
      debitNoteMode: text(sql`c.debit_note_mode`),
      debitNoteTemplateName: text(sql`dnt.name`),
      linkedSupplierName: text(sql`sup.name`),
      createdAt: date(sql`c.created_at`),
      updatedAt: date(sql`c.updated_at`),
    },
    softDeleteSql: sql`c.deleted_at IS NULL`,
    defaultOrder: sql`c.name ASC`,
  },
  suppliers: {
    meta: {
      entity: 'suppliers',
      title: 'Nhà cung cấp',
      description: 'Vendor/nhà cung cấp, liên hệ, mã số thuế, ghi chú, nhà cung cấp dầu.',
      searchableFields: ['name', 'taxCode', 'contactPerson', 'phone', 'note'],
      listFields: ['id', 'name', 'taxCode', 'phone', 'status', 'isFuelSupplier'],
      detailFields: ['id', 'name', 'contactPerson', 'phone', 'taxCode', 'note', 'status', 'isFuelSupplier', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'status', 'isFuelSupplier'],
      aggregateMetrics: ['count'],
      timelineFields: ['createdAt', 'updatedAt'],
    },
    from: sql`suppliers sup`,
    fields: {
      id: number(sql`sup.id`),
      name: text(sql`sup.name`),
      contactPerson: text(sql`sup.contact_person`),
      phone: text(sql`sup.phone`),
      taxCode: text(sql`sup.tax_code`),
      note: text(sql`sup.note`),
      status: text(sql`sup.status`),
      isFuelSupplier: bool(sql`sup.is_fuel_supplier`),
      createdAt: date(sql`sup.created_at`),
      updatedAt: date(sql`sup.updated_at`),
    },
    softDeleteSql: sql`sup.deleted_at IS NULL`,
    defaultOrder: sql`sup.name ASC`,
  },
  expenses: {
    meta: {
      entity: 'expenses',
      title: 'Chi phí phát sinh',
      description: 'Chi phí vận hành/bảo dưỡng gắn nhà cung cấp, hạng mục, xe/rơ-moóc hoặc toàn công ty.',
      searchableFields: ['supplierName', 'categoryName', 'vehiclePlate', 'note', 'receiptId'],
      listFields: ['id', 'expenseDate', 'supplierName', 'categoryName', 'vehicleComponent', 'vehiclePlate', 'amount', 'paymentStatus', 'validTo', 'note'],
      detailFields: ['id', 'expenseDate', 'supplierName', 'categoryName', 'vehicleComponent', 'vehiclePlate', 'amount', 'paymentStatus', 'validFrom', 'validTo', 'receiptId', 'note', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'supplierId', 'categoryId', 'vehicleComponent', 'paymentStatus', 'expenseDate'],
      aggregateMetrics: ['count', 'amount'],
      timelineFields: ['expenseDate', 'validFrom', 'validTo', 'createdAt', 'updatedAt'],
    },
    from: sql`expenses e
      LEFT JOIN suppliers sup ON sup.id = e.supplier_id
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      LEFT JOIN trucks tr ON e.vehicle_component = 'TRUCK' AND tr.id = e.truck_id
      LEFT JOIN trailers tl ON e.vehicle_component = 'TRAILER' AND tl.id = e.truck_id`,
    fields: {
      id: number(sql`e.id`),
      expenseDate: date(sql`e.expense_date`),
      supplierId: number(sql`e.supplier_id`),
      supplierName: text(sql`sup.name`),
      categoryId: number(sql`e.category_id`),
      categoryName: text(sql`ec.name`),
      vehicleComponent: text(sql`e.vehicle_component`),
      vehiclePlate: text(sql`COALESCE(tr.license_plate, tl.license_plate)`),
      amount: number(sql`e.amount`),
      paymentStatus: text(sql`e.payment_status`),
      validFrom: date(sql`e.valid_from`),
      validTo: date(sql`e.valid_to`),
      receiptId: text(sql`e.receipt_id`),
      note: text(sql`e.note`),
      createdAt: date(sql`e.created_at`),
      updatedAt: date(sql`e.updated_at`),
    },
    dateField: 'expenseDate',
    softDeleteSql: sql`e.deleted_at IS NULL`,
    defaultOrder: sql`e.expense_date DESC, e.id DESC`,
  },
  ledger: {
    meta: {
      entity: 'ledger',
      title: 'Sổ cái',
      description: 'Dòng ledger bất biến: entity_type/entity_id, debit/credit/balance, receipt và ghi chú.',
      searchableFields: ['txnType', 'receiptId', 'entityType', 'note', 'entityName'],
      listFields: ['id', 'timestamp', 'txnType', 'entityType', 'entityId', 'entityName', 'credit', 'debit', 'balance', 'note'],
      detailFields: ['id', 'timestamp', 'txnType', 'txnId', 'receiptId', 'entityType', 'entityId', 'entityName', 'credit', 'debit', 'balance', 'note', 'createdAt'],
      filterFields: ['id', 'txnType', 'entityType', 'entityId', 'timestamp'],
      aggregateMetrics: ['count'],
      timelineFields: ['timestamp', 'createdAt'],
    },
    from: sql`ledger l
      LEFT JOIN customers lc ON l.entity_type IN ('CLIENT', 'CUSTOMER') AND lc.id = l.entity_id
      LEFT JOIN drivers ld ON l.entity_type = 'DRIVER' AND ld.id = l.entity_id
      LEFT JOIN suppliers ls ON l.entity_type = 'VENDOR' AND ls.id = l.entity_id`,
    fields: {
      id: number(sql`l.id`),
      timestamp: date(sql`l.timestamp`),
      txnType: text(sql`l.txn_type`),
      txnId: number(sql`l.txn_id`),
      receiptId: text(sql`l.receipt_id`),
      entityType: text(sql`l.entity_type`),
      entityId: number(sql`l.entity_id`),
      entityName: text(sql`COALESCE(lc.name, ld.name, ls.name)`),
      credit: number(sql`l.credit`),
      debit: number(sql`l.debit`),
      balance: number(sql`l.balance`),
      note: text(sql`l.note`),
      createdAt: date(sql`l.created_at`),
    },
    dateField: 'timestamp',
    defaultOrder: sql`l.timestamp DESC, l.id DESC`,
  },
  penalties: {
    meta: {
      entity: 'penalties',
      title: 'Kỷ luật',
      description: 'Khoản phạt tài xế, lý do, chuyến liên quan, số tiền và trạng thái.',
      searchableFields: ['driverName', 'tripCode', 'reasonText', 'customReason'],
      listFields: ['id', 'date', 'driverName', 'tripCode', 'reasonText', 'customReason', 'amount', 'status'],
      detailFields: ['id', 'date', 'driverName', 'tripCode', 'reasonText', 'customReason', 'amount', 'status', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'driverId', 'tripId', 'status', 'date'],
      aggregateMetrics: ['count', 'amount'],
      timelineFields: ['date', 'createdAt', 'updatedAt'],
    },
    from: sql`penalties p
      LEFT JOIN drivers d ON d.id = p.driver_id
      LEFT JOIN trips t ON t.id = p.trip_id
      LEFT JOIN penalty_reasons pr ON pr.id = p.reason_id`,
    fields: {
      id: number(sql`p.id`),
      date: date(sql`p.date`),
      driverId: number(sql`p.driver_id`),
      driverName: text(sql`d.name`),
      tripId: number(sql`p.trip_id`),
      tripCode: text(sql`t.trip_code`),
      reasonText: text(sql`pr.reason_text`),
      customReason: text(sql`p.custom_reason`),
      amount: number(sql`p.amount`),
      status: text(sql`p.status`),
      createdAt: date(sql`p.created_at`),
      updatedAt: date(sql`p.updated_at`),
    },
    dateField: 'date',
    softDeleteSql: sql`p.deleted_at IS NULL`,
    defaultOrder: sql`p.date DESC, p.id DESC`,
  },
  debitNoteTemplates: {
    meta: {
      entity: 'debitNoteTemplates',
      title: 'Mẫu giấy báo nợ',
      description: 'Mẫu Excel giấy báo nợ/payment statement: tên, mặc định, loại tài liệu, tiêu đề, cột và chữ ký.',
      searchableFields: ['name', 'documentType', 'titleText', 'issuerName'],
      listFields: ['id', 'name', 'isDefault', 'documentType', 'titleText', 'issuerName', 'groupingMode'],
      detailFields: ['id', 'name', 'isDefault', 'documentType', 'titleText', 'issuerName', 'issuerAddress', 'issuerTaxCode', 'issuerRepresentative', 'accentColor', 'showContainerColumn', 'showUnitColumn', 'groupingMode', 'orientation', 'termsText', 'signatureLeftLabel', 'signatureLeftName', 'signatureRightLabel', 'signatureRightName', 'createdAt', 'updatedAt'],
      filterFields: ['id', 'isDefault', 'documentType', 'groupingMode'],
      aggregateMetrics: ['count'],
      timelineFields: ['createdAt', 'updatedAt'],
    },
    from: sql`debit_note_templates dnt`,
    fields: {
      id: number(sql`dnt.id`),
      name: text(sql`dnt.name`),
      isDefault: bool(sql`dnt.is_default`),
      documentType: text(sql`dnt.document_type`),
      titleText: text(sql`dnt.title_text`),
      issuerName: text(sql`dnt.issuer_name`),
      issuerAddress: text(sql`dnt.issuer_address`),
      issuerTaxCode: text(sql`dnt.issuer_tax_code`),
      issuerRepresentative: text(sql`dnt.issuer_representative`),
      accentColor: text(sql`dnt.accent_color`),
      showContainerColumn: bool(sql`dnt.show_container_column`),
      showUnitColumn: bool(sql`dnt.show_unit_column`),
      groupingMode: text(sql`dnt.grouping_mode`),
      orientation: text(sql`dnt.orientation`),
      termsText: text(sql`dnt.terms_text`),
      signatureLeftLabel: text(sql`dnt.signature_left_label`),
      signatureLeftName: text(sql`dnt.signature_left_name`),
      signatureRightLabel: text(sql`dnt.signature_right_label`),
      signatureRightName: text(sql`dnt.signature_right_name`),
      createdAt: date(sql`dnt.created_at`),
      updatedAt: date(sql`dnt.updated_at`),
    },
    softDeleteSql: sql`dnt.deleted_at IS NULL`,
    defaultOrder: sql`dnt.is_default DESC, dnt.name ASC`,
  },
  auditLogs: {
    meta: {
      entity: 'auditLogs',
      title: 'Nhật ký audit',
      description: 'Audit log tiếng Việt cho các mutation API: actor, message, entity, payload và thời gian.',
      searchableFields: ['actorName', 'message', 'entityType'],
      listFields: ['id', 'timestamp', 'actorName', 'message', 'entityType', 'entityId'],
      detailFields: ['id', 'timestamp', 'actorName', 'message', 'entityType', 'entityId', 'payload', 'ipAddress', 'createdAt'],
      filterFields: ['id', 'userId', 'actorName', 'entityType', 'entityId', 'timestamp'],
      aggregateMetrics: ['count'],
      timelineFields: ['timestamp', 'createdAt'],
    },
    from: sql`audit_logs a`,
    fields: {
      id: number(sql`a.id`),
      timestamp: date(sql`a.timestamp`),
      userId: number(sql`a.user_id`),
      actorName: text(sql`a.actor_name`),
      message: text(sql`a.message`),
      entityType: text(sql`a.entity_type`),
      entityId: number(sql`a.entity_id`),
      payload: text(sql`a.payload::text`),
      ipAddress: text(sql`a.ip_address`),
      createdAt: date(sql`a.created_at`),
    },
    dateField: 'timestamp',
    defaultOrder: sql`a.timestamp DESC, a.id DESC`,
  },
  companyInfo: {
    meta: {
      entity: 'companyInfo',
      title: 'Thông tin công ty',
      description: 'Hồ sơ pháp lý của chính công ty: tên, địa chỉ, mã số thuế, người đại diện và tài khoản ngân hàng.',
      searchableFields: ['name', 'address', 'taxCode', 'representative', 'representativeTitle', 'bankAccount', 'bankName'],
      listFields: ['id', 'name', 'taxCode', 'representative', 'representativeTitle', 'bankAccount', 'bankName'],
      detailFields: ['id', 'name', 'address', 'taxCode', 'representative', 'representativeTitle', 'bankAccount', 'bankName', 'updatedAt'],
      filterFields: ['id', 'taxCode'],
      aggregateMetrics: ['count'],
      timelineFields: ['updatedAt'],
    },
    // setting_key literals below mirror Object.values(COMPANY_INFO_SETTING_KEYS)
    // (services/company-info.service.ts). Raw SQL can't import the TS const, so
    // keep them in sync when a key is added/renamed.
    from: sql`(
      SELECT
        1 AS id,
        MAX(setting_value) FILTER (WHERE setting_key = 'company.name') AS name,
        MAX(setting_value) FILTER (WHERE setting_key = 'company.address') AS address,
        MAX(setting_value) FILTER (WHERE setting_key = 'company.tax_code') AS tax_code,
        MAX(setting_value) FILTER (WHERE setting_key = 'company.representative') AS representative,
        MAX(setting_value) FILTER (WHERE setting_key = 'company.representative_title') AS representative_title,
        MAX(setting_value) FILTER (WHERE setting_key = 'company.bank_account') AS bank_account,
        MAX(setting_value) FILTER (WHERE setting_key = 'company.bank_name') AS bank_name,
        MAX(updated_at) AS updated_at
      FROM app_settings
      WHERE setting_key LIKE 'company.%'
      -- Guard the phantom row: an aggregate with no GROUP BY always yields one
      -- row, so without this HAVING an empty app_settings would surface a
      -- {id:1, name:null, …} "company" that doesn't really exist.
      HAVING MAX(updated_at) IS NOT NULL
    ) ci`,
    fields: {
      id: number(sql`ci.id`),
      name: text(sql`ci.name`),
      address: text(sql`ci.address`),
      taxCode: text(sql`ci.tax_code`),
      representative: text(sql`ci.representative`),
      representativeTitle: text(sql`ci.representative_title`),
      bankAccount: text(sql`ci.bank_account`),
      bankName: text(sql`ci.bank_name`),
      updatedAt: date(sql`ci.updated_at`),
    },
    dateField: 'updatedAt',
    defaultOrder: sql`ci.id ASC`,
  },
};

export function listSemanticEntities(): SemanticEntityMeta[] {
  return SEMANTIC_ENTITIES.map((entity) => ENTITIES[entity].meta);
}

export function getSemanticEntityMeta(entity: SemanticEntity): SemanticEntityMeta {
  return ENTITIES[entity].meta;
}

/** Field names this entity projects (keys of its `fields` map). Exposed for the
 *  drift-validation test: buildSelect/buildWhere SILENTLY skip a field that is
 *  listed in meta but absent from `fields`, so a renamed/removed SQL anchor would
 *  vanish from results with no error. The test asserts meta ⊆ fields. */
export function entityFieldNames(entity: SemanticEntity): string[] {
  return Object.keys(ENTITIES[entity].fields);
}

export async function semanticSearch(query: string, limit = MAX_SEARCH_PER_ENTITY) {
  const term = query.trim();
  if (!term) return [];
  const perEntityLimit = clampLimit(limit, MAX_SEARCH_PER_ENTITY);
  // Fan out across all entities concurrently (was a sequential await loop → one
  // serial DB round-trip per entity, ~11 trips per search). SEMANTIC_ENTITIES
  // order is preserved in the mapped result.
  const entries = await Promise.all(
    SEMANTIC_ENTITIES.map(async (entity) => ({
      entity,
      rows: await semanticList({ entity, search: term, limit: perEntityLimit }, 'list'),
    })),
  );
  return entries
    .filter((e) => e.rows.length)
    .map(({ entity, rows }) => ({ entity, title: ENTITIES[entity].meta.title, rows }));
}

export async function semanticList(query: SemanticQuery, fieldMode: 'list' | 'detail' = 'list') {
  const def = ENTITIES[query.entity];
  const fields = fieldMode === 'detail' ? def.meta.detailFields : def.meta.listFields;
  const selectSql = buildSelect(def, fields);
  const whereSql = buildWhere(def, query);
  const rows = await db.execute(sql`
    SELECT ${selectSql}
    FROM ${def.from}
    ${whereSql}
    ORDER BY ${def.defaultOrder}
    LIMIT ${clampLimit(query.limit, MAX_LIST_LIMIT)}
  `);
  return normalizeRows(rows);
}

export async function semanticDetail(entity: SemanticEntity, id: number) {
  const rows = await semanticList({ entity, filters: { id }, limit: 1 }, 'detail');
  return rows[0] ?? null;
}

export async function semanticAggregate(query: SemanticAggregateQuery) {
  const def = ENTITIES[query.entity];
  const metric = query.metric === 'count' ? 'count' : query.metric;
  if (!def.meta.aggregateMetrics.includes(metric)) {
    throw new Error(`Metric "${metric}" is not allowed for ${query.entity}`);
  }
  const groupField = query.groupBy ? def.fields[query.groupBy] : undefined;
  if (query.groupBy && !groupField) {
    throw new Error(`Group field "${query.groupBy}" is not allowed for ${query.entity}`);
  }
  const metricExpr = metric === 'count'
    ? sql`COUNT(*)::bigint`
    : sql`COALESCE(SUM((${def.fields[metric].expr})::numeric), 0)`;
  const whereSql = buildWhere(def, query);
  const rows = await db.execute(query.groupBy && groupField
    ? sql`
      SELECT ${groupField.expr} AS "group", ${metricExpr} AS "value"
      FROM ${def.from}
      ${whereSql}
      GROUP BY ${groupField.expr}
      ORDER BY "value" DESC
      LIMIT ${clampLimit(query.limit, 50)}
    `
    : sql`
      SELECT ${metricExpr} AS "value"
      FROM ${def.from}
      ${whereSql}
    `);
  return normalizeRows(rows);
}

export async function semanticTimeline(query: SemanticQuery) {
  const def = ENTITIES[query.entity];
  const timelineFields = def.meta.timelineFields.filter((field) => def.fields[field]);
  const fields = Array.from(new Set(['id', ...timelineFields, ...def.meta.listFields.slice(0, 4)]));
  const selectSql = buildSelect(def, fields);
  const whereSql = buildWhere(def, query);
  // When the entity has a date field, order the timeline by it DESC (most recent
  // first). Entities WITHOUT a dateField (customers/suppliers/drivers/trucks/
  // trailers/debitNoteTemplates) fall back to defaultOrder AS-IS — defaultOrder
  // already carries its own ASC/DESC, so appending "DESC NULLS LAST" here would
  // double-specify direction (`ORDER BY c.name ASC DESC …`) and throw a SQL
  // syntax error on every data.timeline call for those entities.
  const orderField = def.dateField && def.fields[def.dateField]
    ? sql`${def.fields[def.dateField].expr} DESC NULLS LAST`
    : def.defaultOrder;
  const rows = await db.execute(sql`
    SELECT ${selectSql}
    FROM ${def.from}
    ${whereSql}
    ORDER BY ${orderField}
    LIMIT ${clampLimit(query.limit, 50)}
  `);
  return normalizeRows(rows);
}

function buildSelect(def: EntityDef, fields: string[]): SQL {
  const chunks: SQL[] = [];
  for (const field of fields) {
    const fieldDef = def.fields[field];
    if (!fieldDef) continue;
    chunks.push(sql`${fieldDef.expr} AS ${sql.identifier(field)}`);
  }
  if (chunks.length === 0) chunks.push(sql`${def.fields.id.expr} AS "id"`);
  return sql.join(chunks, sql`, `);
}

function buildWhere(def: EntityDef, query: SemanticQuery): SQL {
  const conditions: SQL[] = [];
  if (def.softDeleteSql) conditions.push(def.softDeleteSql);
  if (query.search?.trim()) {
    const term = `%${escapeLike(query.search.trim())}%`;
    const searchParts = def.meta.searchableFields
      .map((field) => def.fields[field])
      .filter(Boolean)
      .map((field) => sql`unaccent(COALESCE((${field.expr})::text, '')) ILIKE unaccent(${term})`);
    if (searchParts.length) conditions.push(sql`(${sql.join(searchParts, sql` OR `)})`);
  }
  if (query.filters) {
    for (const [field, rawValue] of Object.entries(query.filters)) {
      if (rawValue === undefined || rawValue === null || rawValue === '') continue;
      const fieldDef = def.fields[field];
      if (!fieldDef || !def.meta.filterFields.includes(field)) continue;
      conditions.push(buildFilter(fieldDef, rawValue));
    }
  }
  if (query.dateFrom && def.dateField) {
    const field = def.fields[def.dateField];
    conditions.push(sql`${field.expr} >= ${query.dateFrom}`);
  }
  if (query.dateTo && def.dateField) {
    const field = def.fields[def.dateField];
    conditions.push(sql`${field.expr} <= ${query.dateTo}`);
  }
  return conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;
}

function buildFilter(field: FieldDef, value: string | number | boolean): SQL {
  if (field.type === 'string') {
    return sql`unaccent(COALESCE((${field.expr})::text, '')) ILIKE unaccent(${`%${escapeLike(String(value))}%`})`;
  }
  if (field.type === 'boolean') {
    return sql`${field.expr} = ${coerceBoolean(value)}`;
  }
  return sql`${field.expr} = ${value}`;
}

function normalizeRows(rows: unknown): Array<Record<string, unknown>> {
  const maybeRows = rows as { rows?: Array<Record<string, unknown>> };
  if (Array.isArray(maybeRows.rows)) return maybeRows.rows.map(normalizeRow);
  if (Array.isArray(rows)) return rows.map((row) => normalizeRow(row as Record<string, unknown>));
  return [];
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) out[key] = value.toISOString();
    else out[key] = value;
  }
  if (out.status && typeof out.status === 'string' && !out.statusLabel && out.status in TIRE_STATUS_LABELS) {
    out.statusLabel = TIRE_STATUS_LABELS[out.status as TireStatus];
  }
  return out;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function clampLimit(limit: unknown, max: number): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return Math.min(20, max);
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

function coerceBoolean(value: string | number | boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', '1', 'yes', 'y', 'active'].includes(value.toLowerCase());
}
