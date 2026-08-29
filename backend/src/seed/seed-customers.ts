/**
 * Seed customers and the linked supplier records from the customer's
 * THÔNG TIN NCC sheet. Long Minh is both the cargo-owning customer and the
 * debit-note recipient, so we create a partner + customer + linked supplier.
 *
 * Also seeds app_settings company identity (Silver Sea) from the DEBIT LONG
 * MINH template header, so exports carry the real issuer identity.
 *
 * Part of plans/260731-customer-audit-reseed.
 */
import { sql } from 'drizzle-orm';
import type { DebitNoteTemplateColumn } from '@tingting/shared';
import { db } from '../db/index.js';
import * as s from '../db/schema/index.js';
import { COMPANY_INFO_SETTING_KEYS } from '../services/company-info.service.js';
import { customers, companyIdentity } from './data/index.js';
import { normalizedTextEquals } from './seed-identity.js';

const LONG_MINH_TEMPLATE_NAME = 'MẪU DEBIT LONG MINH';
const LONG_MINH_DEBIT_TEMPLATE_COLUMNS: DebitNoteTemplateColumn[] = [
  { id: 'stt', label: 'STT', variable: 'rowIndex', headerGroup: null, width: 6, align: 'center', format: 'number', total: false },
  { id: 'nha_may', label: 'TÊN NHÀ MÁY', variable: 'factoryName', headerGroup: null, width: 18, align: 'left', format: 'text', total: false },
  { id: 'xuat_nhap', label: 'NHẬP/ XUẤT', variable: 'tradeDirectionLabel', headerGroup: null, width: 10, align: 'center', format: 'text', total: false },
  { id: 'so_bill', label: 'SỐ BILL', variable: 'billNumber', headerGroup: null, width: 14, align: 'center', format: 'text', total: false },
  { id: 'so_to_khai', label: 'SỐ TỜ KHAI', variable: 'declarationNumber', headerGroup: null, width: 14, align: 'center', format: 'text', total: false },
  { id: 'so_luong', label: 'SỐ CÂN/ KIỆN/ CONT', variable: 'quantityLabel', headerGroup: null, width: 18, align: 'left', format: 'text', total: false },
  { id: 'loai_xe', label: 'LOẠI XE', variable: 'vehicleType', headerGroup: null, width: 12, align: 'center', format: 'text', total: false },
  { id: 'bien_so', label: 'BKS', variable: 'truckPlate', headerGroup: null, width: 12, align: 'center', format: 'text', total: false },
  { id: 'cbm', label: 'CBM', variable: 'cargoVolumeCbm', headerGroup: null, width: 10, align: 'right', format: 'number', total: false },
  { id: 'ngay_giao', label: 'NGÀY GIAO HÀNG', variable: 'deliveryDate', headerGroup: null, width: 12, align: 'center', format: 'date', total: false },
  { id: 'tuyen_duong', label: 'TUYẾN ĐƯỜNG MỚI', variable: 'routeName', headerGroup: null, width: 20, align: 'left', format: 'text', total: false },
  { id: 'phi_giao_hang', label: 'PHÍ GIAO HÀNG', variable: 'deliveryFeeAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 12, align: 'right', format: 'currency', total: true },
  { id: 'cuoc_van_chuyen', label: 'CƯỚC VẬN CHUYỂN', variable: 'freightAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 14, align: 'right', format: 'currency', total: true },
  { id: 'lach_huyen', label: 'LẠCH HUYỆN', variable: 'portFeeAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 12, align: 'right', format: 'currency', total: true },
  { id: 'chi_phi_khac', label: 'CHI PHÍ KHÁC', variable: 'otherServiceFeeAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 12, align: 'right', format: 'currency', total: true },
  { id: 'phu_phi_xang_dau', label: 'PHỤ PHÍ XĂNG DẦU', variable: 'fuelSurchargeAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 12, align: 'right', format: 'currency', total: true },
  { id: 'ncc', label: 'TÊN ĐƠN VỊ', variable: 'recoverableSupplierName', headerGroup: 'PHÍ CHI HỘ', width: 18, align: 'left', format: 'text', total: false },
  { id: 'loai_phi', label: 'LOẠI PHÍ', variable: 'recoverableFeeType', headerGroup: 'PHÍ CHI HỘ', width: 18, align: 'left', format: 'text', total: false },
  { id: 'so_chung_tu', label: 'SỐ HĐ', variable: 'recoverableDocumentCode', headerGroup: 'PHÍ CHI HỘ', width: 14, align: 'center', format: 'text', total: false },
  { id: 'so_tien', label: 'SỐ TIỀN', variable: 'recoverableAmount', headerGroup: 'PHÍ CHI HỘ', width: 12, align: 'right', format: 'currency', total: true },
];

/** Normalize a tax code for the partners.unique_normalized_tax_code index. */
function normTax(t: string): string {
  return (t || '').trim().toUpperCase().replace(/\s+/g, '');
}

export interface CustomerSeedResult {
  customerByCode: Map<string, number>; // internalCode -> customerId
}

export async function seedCustomers(): Promise<CustomerSeedResult> {
  const customerByCode = new Map<string, number>();
  if (customers.length === 0) return { customerByCode };

  for (const c of customers) {
    const normalized = normTax(c.taxCode);
    const partnerValues = {
      normalizedTaxCode: normalized,
      displayTaxCode: c.taxCode.trim(),
      currency: 'VND',
    } as const;
    const [existingPartner] = await db.select({ id: s.partners.id })
      .from(s.partners)
      .where(normalizedTextEquals(s.partners.normalizedTaxCode, normalized))
      .limit(1);

    let partnerId: number;
    if (existingPartner) {
      await db.update(s.partners)
        .set({ ...partnerValues, updatedAt: new Date() })
        .where(sql`${s.partners.id} = ${existingPartner.id}`);
      partnerId = existingPartner.id;
    } else {
      const [createdPartner] = await db.insert(s.partners)
        .values(partnerValues)
        .returning({ id: s.partners.id });
      partnerId = createdPartner!.id;
    }

    // Supplier has no unique constraint besides PK — guard against dupes by
    // looking up (name, partnerId) first, then insert-or-update in JS.
    const existingSupplier = await db.select({ id: s.suppliers.id })
      .from(s.suppliers)
      .where(sql`lower(btrim(${s.suppliers.name})) = lower(btrim(${c.name})) AND ${s.suppliers.partnerId} = ${partnerId}`);
    const supplierRow = {
      name: c.name,
      taxCode: c.taxCode,
      partnerId,
      phone: c.directorPhone || null,
      note: c.email ? `Email: ${c.email}` : null,
      status: 'ACTIVE',
      updatedAt: new Date(),
    };
    let supplierId: number;
    if (existingSupplier.length > 0) {
      await db.update(s.suppliers).set(supplierRow).where(sql`${s.suppliers.id} = ${existingSupplier[0]!.id}`);
      supplierId = existingSupplier[0]!.id;
    } else {
      const [ins] = await db.insert(s.suppliers).values(supplierRow).returning({ id: s.suppliers.id });
      supplierId = ins!.id;
    }

    // The active customer keys are normalized expression indexes, so PostgreSQL
    // cannot infer them from an ON CONFLICT(name, tax_code) target. Resolve the
    // active row explicitly, then update or insert deterministically.
    const customerValues = {
      name: c.name,
      shortName: c.internalCode,
      taxCode: c.taxCode,
      partnerId,
      contactPerson: c.manager || null,
      phone: c.directorPhone || null,
      contactInfo: c.email || null,
      // payment-term days drive AR aging (M5.1). Long Minh: 15 days cước.
      paymentTermDays: c.paymentTermCuocDays ?? null,
      fuelSurchargeSharePct: c.internalCode === 'LONG MINH' ? '50.00' : null,
      status: 'ACTIVE',
      debitNoteMode: 'MONTHLY',
      linkedSupplierId: supplierId,
    } as const;
    const [existingCustomer] = await db.select({ id: s.customers.id })
      .from(s.customers)
      .where(sql`
        ${s.customers.deletedAt} is null
        and lower(btrim(${s.customers.name})) = lower(btrim(${c.name}))
        and coalesce(nullif(lower(btrim(${s.customers.taxCode})), ''), '')
          = coalesce(nullif(lower(btrim(${c.taxCode})), ''), '')
      `)
      .limit(1);
    let customerId: number;
    if (existingCustomer) {
      await db.update(s.customers)
        .set({ ...customerValues, updatedAt: new Date() })
        .where(sql`${s.customers.id} = ${existingCustomer.id}`);
      customerId = existingCustomer.id;
    } else {
      const [createdCustomer] = await db.insert(s.customers)
        .values(customerValues)
        .returning({ id: s.customers.id });
      customerId = createdCustomer!.id;
    }

    customerByCode.set(c.internalCode, customerId);
  }

  await seedCompanySettings();
  await seedLongMinhDebitTemplate(customerByCode);
  console.log(`✅ Customers seeded! (${customers.length})`);
  for (const c of customers) console.log(`   • ${c.internalCode} → ${c.name}`);
  return { customerByCode };
}

/**
 * Seed Silver Sea company identity into app_settings. The customer explicitly
 * wants their real data here (plan D1), so we upsert (not DoNothing) — this is
 * the source of truth for export headers.
 */
async function seedCompanySettings(): Promise<void> {
  const settings: Array<[string, string]> = [
    [COMPANY_INFO_SETTING_KEYS.name, companyIdentity.name],
    [COMPANY_INFO_SETTING_KEYS.address, companyIdentity.address],
    [COMPANY_INFO_SETTING_KEYS.taxCode, companyIdentity.taxCode],
    [COMPANY_INFO_SETTING_KEYS.phone, companyIdentity.phone],
    [COMPANY_INFO_SETTING_KEYS.email, companyIdentity.email],
    [COMPANY_INFO_SETTING_KEYS.bankAccount, companyIdentity.bankAccount],
    [COMPANY_INFO_SETTING_KEYS.bankName, companyIdentity.bankName],
    [COMPANY_INFO_SETTING_KEYS.representative, companyIdentity.representative],
  ];
  for (const [key, value] of settings) {
    if (!value) continue;
    await db.insert(s.appSettings).values({ key, value })
      .onConflictDoUpdate({ target: s.appSettings.key, set: { value } });
  }
  console.log(`✅ Company identity seeded (Silver Sea, MST ${companyIdentity.taxCode})`);
}

async function seedLongMinhDebitTemplate(customerByCode: Map<string, number>): Promise<void> {
  const customerId = customerByCode.get('LONG MINH');
  if (!customerId) return;

  const templateValues = {
    name: LONG_MINH_TEMPLATE_NAME,
    isDefault: false,
    documentType: 'DEBIT_NOTE',
    titleText: 'BẢNG KÊ XÁC NHẬN VẬN CHUYỂN HOÀN THÀNH / MẪU DEBIT LONG MINH',
    issuerName: null,
    issuerAddress: null,
    issuerTaxCode: null,
    issuerRepresentative: null,
    accentColor: '#1F4E79',
    showContainerColumn: true,
    showUnitColumn: true,
    groupingMode: 'NONE',
    columns: LONG_MINH_DEBIT_TEMPLATE_COLUMNS,
    amountInWords: false,
    orientation: 'landscape',
    termsText: 'Vui lòng đối chiếu các khoản phí dịch vụ và phí chi hộ theo từng chuyến đủ điều kiện.',
    signatureLeftLabel: 'Khách hàng',
    signatureLeftName: null,
    signatureRightLabel: 'Người lập',
    signatureRightName: null,
    updatedAt: new Date(),
  } as const;

  const [existing] = await db.select({ id: s.debitNoteTemplates.id })
    .from(s.debitNoteTemplates)
    .where(sql`
      lower(btrim(${s.debitNoteTemplates.name})) = lower(btrim(${LONG_MINH_TEMPLATE_NAME}))
      and ${s.debitNoteTemplates.documentType} = 'DEBIT_NOTE'
      and ${s.debitNoteTemplates.deletedAt} is null
    `)
    .limit(1);

  let templateId: number;
  if (existing) {
    await db.update(s.debitNoteTemplates)
      .set(templateValues)
      .where(sql`${s.debitNoteTemplates.id} = ${existing.id}`);
    templateId = existing.id;
  } else {
    const [created] = await db.insert(s.debitNoteTemplates)
      .values(templateValues)
      .returning({ id: s.debitNoteTemplates.id });
    templateId = created!.id;
  }

  await db.update(s.customers)
    .set({ debitNoteTemplateId: templateId, updatedAt: new Date() })
    .where(sql`${s.customers.id} = ${customerId}`);
  console.log(`✅ Long Minh debit template seeded and assigned (internal template key ${templateId})`);
}
