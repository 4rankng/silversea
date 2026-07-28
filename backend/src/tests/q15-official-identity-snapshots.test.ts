import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { client, db } from '../db';
import * as s from '../db/schema';
import {
  COMPANY_INFO_SETTING_KEYS,
  type CompanyInfoField,
} from '../services/company-info.service';
import {
  generateDraft,
  getDocument,
  renderTemplatedXlsx,
  resolveDebitNoteTemplateForDoc,
  saveDocument,
} from '../services/billingDocument.service';
import { transitionDebitNoteStatus } from '../services/debit-note-lifecycle.service';
import { exportDebitNoteHtml } from '../services/debit-note-pdf.service';
import type { BillingDocument, DebitNoteTemplateSnapshot, SaveBillingDocumentInput } from '@tingting/shared';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const customerIds: number[] = [];
const routeIds: number[] = [];
const cargoTypeIds: number[] = [];
const tripIds: number[] = [];
const documentIds: number[] = [];
const sourceLockDocIds: number[] = [];
const templateIds: number[] = [];
let originalCompanyRows: Array<typeof s.appSettings.$inferSelect> = [];

type CompanySeed = Record<Exclude<CompanyInfoField, 'logoStorageKey'>, string> & {
  logoStorageKey?: string | null;
};

const COMPANY_OLD: CompanySeed = {
  name: 'Công ty Phát hành Cũ',
  address: '12 Bến Cũ, Hải Phòng',
  taxCode: '0311000001',
  representative: 'Nguyễn Văn Cũ',
  representativeTitle: 'Giám đốc',
  bankAccount: '111122223333',
  bankName: 'VCB Hải Phòng',
  phone: '0909000001',
  email: 'old-company@example.com',
  logoStorageKey: null,
};

const COMPANY_NEW: CompanySeed = {
  name: 'Công ty Phát hành Mới',
  address: '99 Bến Mới, Hải Phòng',
  taxCode: '0311000002',
  representative: 'Nguyễn Văn Mới',
  representativeTitle: 'Tổng giám đốc',
  bankAccount: '999988887777',
  bankName: 'ACB Hải Phòng',
  phone: '0909000002',
  email: 'new-company@example.com',
  logoStorageKey: null,
};

const CUSTOMER_OLD = {
  name: `Khách hàng lịch sử ${suffix}`,
  taxCode: '0300123400',
  contactPerson: 'Trần Kế Toán Cũ',
  phone: '0908111222',
  contactInfo: 'Kho cũ, Quận 7, TP.HCM',
};

const CUSTOMER_NEW = {
  name: `Khách hàng hiện tại ${suffix}`,
  taxCode: '0300123499',
  contactPerson: 'Trần Kế Toán Mới',
  phone: '0908333444',
  contactInfo: 'Kho mới, Quận 9, TP.HCM',
};

async function loadWorkbook(buf: Buffer) {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  await (wb.xlsx.load as (data: unknown) => Promise<unknown>)(buf);
  return wb;
}

async function setCompanyInfo(values: CompanySeed): Promise<void> {
  const now = new Date();
  const rows = (Object.entries(COMPANY_INFO_SETTING_KEYS) as Array<[CompanyInfoField, string]>).map(([field, key]) => ({
    key,
    value: field === 'logoStorageKey'
      ? (values.logoStorageKey ?? '')
      : values[field as Exclude<CompanyInfoField, 'logoStorageKey'>],
    updatedAt: now,
  }));
  await db.insert(s.appSettings)
    .values(rows)
    .onConflictDoUpdate({
      target: s.appSettings.key,
      set: {
        value: sql`excluded.setting_value`,
        updatedAt: now,
      },
    });
}

async function createTripFixture(
  customerId: number,
  opts: { departureDate: string; completedAt: string; revenue: number },
) {
  const [route] = await db.insert(s.routes).values({
    name: `Q15 official route ${suffix}-${routeIds.length}`,
  }).returning();
  routeIds.push(route.id);

  const [cargoType] = await db.insert(s.cargoTypes).values({
    name: `Q15 official cargo ${suffix}-${cargoTypeIds.length}`,
  }).returning();
  cargoTypeIds.push(cargoType.id);

  const [trip] = await db.insert(s.trips).values({
    tripCode: `Q15-OFF-${suffix}-${tripIds.length}`.slice(0, 50),
    customerId,
    routeId: route.id,
    cargoTypeId: cargoType.id,
    departureDate: opts.departureDate,
    completedAt: new Date(opts.completedAt),
    status: 'LOCKED',
    revenue: String(opts.revenue),
    carrierType: 'OWN',
  }).returning();
  tripIds.push(trip.id);
  return trip;
}

async function saveDraftDocument(customerId: number, rangeFrom: string, rangeTo: string): Promise<BillingDocument> {
  const draft = await generateDraft({
    type: 'DEBIT_NOTE',
    entityType: 'CUSTOMER',
    entityId: customerId,
    rangeFrom,
    rangeTo,
  });
  const input: SaveBillingDocumentInput = {
    ...draft,
    lines: draft.lines.map((line) => ({
      ...line,
      renderData: line.renderData ? { ...line.renderData } as Record<string, unknown> : null,
    })),
  };
  const saved = await saveDocument(input, null);
  documentIds.push(saved.id);
  sourceLockDocIds.push(saved.id);
  return saved;
}

function buildHtmlData(doc: BillingDocument) {
  return {
    documentId: doc.id,
    entityName: doc.entityName ?? `#${doc.entityId}`,
    rangeFrom: doc.rangeFrom,
    rangeTo: doc.rangeTo,
    originalDueDate: doc.originalDueDate,
    processingDueDate: doc.processingDueDate,
    totalInclVat: String(doc.totalInclVat),
    status: doc.debitNoteStatus ?? null,
    lines: doc.lines
      .filter((line) => !line.excluded)
      .map((line) => ({
        lineType: line.lineType,
        typeLabel: line.typeLabel,
        description: line.description,
        baseAmount: String(line.amountOverride ?? line.baseAmount),
        routeName: line.routeName ?? null,
      })),
  };
}

before(async () => {
  originalCompanyRows = await db.select().from(s.appSettings).where(like(s.appSettings.key, 'company.%'));
});

after(async () => {
  if (sourceLockDocIds.length > 0) {
    await db.delete(s.billingDocumentSourcePeriodLocks).where(inArray(s.billingDocumentSourcePeriodLocks.documentId, sourceLockDocIds));
  }
  if (documentIds.length > 0) {
    await db.delete(s.billingDocumentLines).where(inArray(s.billingDocumentLines.documentId, documentIds));
    await db.delete(s.billingDocuments).where(inArray(s.billingDocuments.id, documentIds));
  }
  if (templateIds.length > 0) {
    await db.delete(s.debitNoteTemplates).where(inArray(s.debitNoteTemplates.id, templateIds));
  }
  if (tripIds.length > 0) {
    await db.delete(s.trips).where(inArray(s.trips.id, tripIds));
  }
  if (cargoTypeIds.length > 0) {
    await db.delete(s.cargoTypes).where(inArray(s.cargoTypes.id, cargoTypeIds));
  }
  if (routeIds.length > 0) {
    await db.delete(s.routes).where(inArray(s.routes.id, routeIds));
  }
  if (customerIds.length > 0) {
    await db.delete(s.customers).where(inArray(s.customers.id, customerIds));
  }
  await db.delete(s.appSettings).where(like(s.appSettings.key, 'company.%'));
  if (originalCompanyRows.length > 0) {
    await db.insert(s.appSettings).values(originalCompanyRows);
  }
  await client.end();
});

test('issued debit-note re-exports keep the issue-time company and customer identity after live edits', async () => {
  await setCompanyInfo(COMPANY_OLD);
  const [customer] = await db.insert(s.customers).values(CUSTOMER_OLD).returning();
  customerIds.push(customer.id);

  await createTripFixture(customer.id, {
    departureDate: '2026-07-15',
    completedAt: '2026-07-15T08:00:00.000Z',
    revenue: 1_250_000,
  });

  const julyDraft = await saveDraftDocument(customer.id, '2026-07-01', '2026-07-31');
  await transitionDebitNoteStatus({
    documentId: julyDraft.id,
    targetStatus: 'SENT',
    expectedStatus: 'DRAFT',
    actorUserId: 1,
  });

  const issuedJuly = await getDocument(julyDraft.id);
  assert.equal(
    issuedJuly.officialIdentitySnapshot?.captureMetadata.mode,
    'ISSUED_AT_TRANSITION',
  );
  assert.equal(issuedJuly.officialIdentitySnapshot?.issuer.name, COMPANY_OLD.name);
  assert.equal(issuedJuly.officialIdentitySnapshot?.counterparty.name, CUSTOMER_OLD.name);
  const julySnapshot = await resolveDebitNoteTemplateForDoc(issuedJuly);
  assert.ok(julySnapshot, 'issued July snapshot should resolve');
  const storedOfficialIdentity = (
    julySnapshot as DebitNoteTemplateSnapshot & {
      officialIdentity?: {
        issuer?: { name?: string; bankAccount?: string };
        counterparty?: { name?: string; address?: string; taxCode?: string };
      } | null;
    }
  ).officialIdentity;
  assert.equal(storedOfficialIdentity?.issuer?.name, COMPANY_OLD.name);
  assert.equal(storedOfficialIdentity?.issuer?.bankAccount, COMPANY_OLD.bankAccount);
  assert.equal(storedOfficialIdentity?.counterparty?.name, CUSTOMER_OLD.name);
  assert.equal(storedOfficialIdentity?.counterparty?.address, CUSTOMER_OLD.contactInfo);
  assert.equal(storedOfficialIdentity?.counterparty?.taxCode, CUSTOMER_OLD.taxCode);

  const julyBeforeBuffer = await renderTemplatedXlsx(issuedJuly, julySnapshot!);
  const julyBeforeWorkbook = await loadWorkbook(julyBeforeBuffer);
  const julyBeforeSheet = julyBeforeWorkbook.worksheets[0];
  const julyBeforeHtml = exportDebitNoteHtml(buildHtmlData(issuedJuly), julySnapshot!, '28/07/2026');

  await setCompanyInfo(COMPANY_NEW);
  await db.update(s.customers).set(CUSTOMER_NEW).where(eq(s.customers.id, customer.id));
  const [newTemplate] = await db.insert(s.debitNoteTemplates).values({
    name: `Q15 history override ${suffix}`,
    documentType: 'DEBIT_NOTE',
    titleText: `KHÔNG ĐƯỢC DÙNG ${suffix}`,
    isDefault: false,
  }).returning();
  templateIds.push(newTemplate.id);

  const issuedJulyAfterChange = await getDocument(julyDraft.id);
  const julyAfterSnapshot = await resolveDebitNoteTemplateForDoc(issuedJulyAfterChange, {
    templateIdOverride: newTemplate.id,
  });
  assert.notEqual(julyAfterSnapshot?.titleText, newTemplate.titleText);
  assert.equal(
    (
      julyAfterSnapshot as DebitNoteTemplateSnapshot & {
        officialIdentity?: { issuer?: { name?: string } } | null;
      }
    ).officialIdentity?.issuer?.name,
    COMPANY_OLD.name,
  );
  const julyAfterBuffer = await renderTemplatedXlsx(issuedJulyAfterChange, julyAfterSnapshot!);
  const julyAfterWorkbook = await loadWorkbook(julyAfterBuffer);
  const julyAfterSheet = julyAfterWorkbook.worksheets[0];
  const julyAfterHtml = exportDebitNoteHtml(buildHtmlData(issuedJulyAfterChange), julyAfterSnapshot!, '28/07/2026');

  assert.equal(julyBeforeSheet.getCell('D1').value, COMPANY_OLD.name);
  assert.equal(julyAfterSheet.getCell('D1').value, COMPANY_OLD.name);
  assert.equal(julyBeforeSheet.getCell('E10').value, CUSTOMER_OLD.name);
  assert.equal(julyAfterSheet.getCell('E10').value, CUSTOMER_OLD.name);
  assert.equal(julyBeforeSheet.getCell(67, 4).value, COMPANY_OLD.bankAccount);
  assert.equal(julyAfterSheet.getCell(67, 4).value, COMPANY_OLD.bankAccount);
  assert.match(julyBeforeHtml, /Công ty Phát hành Cũ/);
  assert.match(julyBeforeHtml, /Kho cũ, Quận 7, TP\.HCM/);
  assert.match(julyBeforeHtml, /0300123400/);
  assert.equal(julyAfterHtml, julyBeforeHtml);

  await createTripFixture(customer.id, {
    departureDate: '2026-08-15',
    completedAt: '2026-08-15T08:00:00.000Z',
    revenue: 1_850_000,
  });
  const augustDraft = await saveDraftDocument(customer.id, '2026-08-01', '2026-08-31');
  await transitionDebitNoteStatus({
    documentId: augustDraft.id,
    targetStatus: 'SENT',
    expectedStatus: 'DRAFT',
    actorUserId: 1,
  });

  const issuedAugust = await getDocument(augustDraft.id);
  const augustSnapshot = await resolveDebitNoteTemplateForDoc(issuedAugust);
  const augustBuffer = await renderTemplatedXlsx(issuedAugust, augustSnapshot!);
  const augustWorkbook = await loadWorkbook(augustBuffer);
  const augustSheet = augustWorkbook.worksheets[0];
  const augustHtml = exportDebitNoteHtml(buildHtmlData(issuedAugust), augustSnapshot!, '28/07/2026');

  assert.equal(augustSheet.getCell('D1').value, COMPANY_NEW.name);
  assert.equal(augustSheet.getCell('E10').value, CUSTOMER_NEW.name);
  assert.equal(augustSheet.getCell(67, 4).value, COMPANY_NEW.bankAccount);
  assert.match(augustHtml, /Công ty Phát hành Mới/);
  assert.match(augustHtml, /Kho mới, Quận 9, TP\.HCM/);
  assert.match(augustHtml, /0300123499/);
});
