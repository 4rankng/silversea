import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { client } from '../db';
import {
  buildBillingXlsx,
  renderTemplatedXlsx,
  templateToSnapshot,
} from '../services/billingDocument.service';
import { defaultDebitNoteColumns, defaultPaymentStatementColumns } from '@tingting/shared';
import type {
  BillingDocument,
  BillingDocumentLine,
  DebitNoteTemplate,
  DebitNoteTemplateColumn,
  DebitNoteTemplateSnapshot,
} from '@tingting/shared';

type SnapshotWithOfficialIdentity = DebitNoteTemplateSnapshot & {
  officialIdentity: {
    issuer: {
      name: string;
      address: string;
      taxCode: string;
      representative: string;
      representativeTitle: string;
      phone: string;
      bankAccount: string;
      bankName: string;
      email: string;
      logoStorageKey: string | null;
    };
    counterparty: {
      entityType: 'CUSTOMER' | 'VENDOR';
      name: string;
      address: string;
      taxCode: string;
      representative: string;
      representativeTitle: string;
      phone: string;
      contactInfo: string;
    };
    signatures: {
      leftLabel: string;
      leftName: string;
      rightLabel: string;
      rightName: string;
    };
  };
};

const line = (over: Partial<BillingDocumentLine>): BillingDocumentLine => ({
  sourceType: 'TRIP', sourceId: 1, lineType: 'FREIGHT', typeLabel: 'Doanh thu', unit: 'lần',
  description: 'Cước vận chuyển — HCM - Bình Dương', routeName: 'HCM - Bình Dương',
  containerNumbers: ['ABCD1234567'], baseAmount: 5_000_000, amountOverride: null,
  excluded: false, sortOrder: 0, ...over,
});

const baseDoc: BillingDocument = {
  id: 1, type: 'DEBIT_NOTE', entityType: 'CUSTOMER', entityId: 10, entityName: 'Công ty ABC',
  rangeFrom: '2026-06-01', rangeTo: '2026-06-30', note: null, totalInclVat: 5_000_000,
  createdBy: null, createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z',
  debitNoteTemplateId: null, debitNoteTemplateSnapshot: null, lines: [line({})],
};
const debitDoc = baseDoc;
const paymentDoc: BillingDocument = { ...baseDoc, type: 'PAYMENT_STATEMENT', entityType: 'VENDOR', entityName: 'NCC X' };

after(async () => {
  await client.end();
});

const columns: DebitNoteTemplateColumn[] = [
  { id: 'desc', label: 'Diễn giải', variable: 'description', width: 40, align: 'left', format: 'text', total: false },
  { id: 'cont', label: 'Số cont', variable: 'containerNumbers', width: 18, align: 'left', format: 'text', total: false },
  { id: 'unit', label: 'ĐVT', variable: 'unit', width: 10, align: 'center', format: 'text', total: false },
  { id: 'amount', label: 'Số tiền', variable: 'amount', width: 16, align: 'right', format: 'currency', total: true },
];

const longMinhColumns: DebitNoteTemplateColumn[] = [
  { id: 'stt', label: 'STT', variable: 'rowIndex', headerGroup: null, width: 6, align: 'center', format: 'number', total: false },
  { id: 'nha_may', label: 'NHÀ MÁY', variable: 'factoryName', headerGroup: null, width: 18, align: 'left', format: 'text', total: false },
  { id: 'xuat_nhap', label: 'NHẬP/ XUẤT', variable: 'tradeDirectionLabel', headerGroup: null, width: 10, align: 'center', format: 'text', total: false },
  { id: 'so_bill', label: 'SỐ BILL', variable: 'billNumber', headerGroup: null, width: 12, align: 'center', format: 'text', total: false },
  { id: 'so_to_khai', label: 'SỐ TỜ KHAI', variable: 'declarationNumber', headerGroup: null, width: 12, align: 'center', format: 'text', total: false },
  { id: 'so_luong', label: 'SỐ CÂN/ KIỆN/ CONT', variable: 'quantityLabel', headerGroup: null, width: 16, align: 'left', format: 'text', total: false },
  { id: 'loai_xe', label: 'LOẠI XE', variable: 'vehicleType', headerGroup: null, width: 10, align: 'center', format: 'text', total: false },
  { id: 'bien_so', label: 'BKS', variable: 'truckPlate', headerGroup: null, width: 12, align: 'center', format: 'text', total: false },
  { id: 'cbm', label: 'CBM', variable: 'cargoVolumeCbm', headerGroup: null, width: 8, align: 'right', format: 'number', total: false },
  { id: 'ngay_giao', label: 'NGÀY GIAO HÀNG', variable: 'deliveryDate', headerGroup: null, width: 12, align: 'center', format: 'date', total: false },
  { id: 'tuyen_duong', label: 'TUYẾN ĐƯỜNG MỚI', variable: 'routeName', headerGroup: null, width: 18, align: 'left', format: 'text', total: false },
  { id: 'phi_giao_hang', label: 'PHÍ GIAO HÀNG', variable: 'deliveryFeeAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 12, align: 'right', format: 'currency', total: true },
  { id: 'cuoc_van_chuyen', label: 'CƯỚC VẬN CHUYỂN', variable: 'freightAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 14, align: 'right', format: 'currency', total: true },
  { id: 'lach_huyen', label: 'LẠCH HUYỆN', variable: 'portFeeAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 12, align: 'right', format: 'currency', total: true },
  { id: 'chi_phi_khac', label: 'CHI PHÍ KHÁC', variable: 'otherServiceFeeAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 12, align: 'right', format: 'currency', total: true },
  { id: 'phu_phi_xang_dau', label: 'PHỤ PHÍ XĂNG DẦU', variable: 'fuelSurchargeAmount', headerGroup: 'PHÍ DỊCH VỤ', width: 12, align: 'right', format: 'currency', total: true },
  { id: 'ten_don_vi', label: 'TÊN ĐƠN VỊ', variable: 'recoverableSupplierName', headerGroup: 'PHÍ CHI HỘ', width: 18, align: 'left', format: 'text', total: false },
  { id: 'loai_phi', label: 'LOẠI PHÍ', variable: 'recoverableFeeType', headerGroup: 'PHÍ CHI HỘ', width: 18, align: 'left', format: 'text', total: false },
  { id: 'so_hd', label: 'SỐ HĐ', variable: 'recoverableDocumentCode', headerGroup: 'PHÍ CHI HỘ', width: 12, align: 'center', format: 'text', total: false },
  { id: 'so_tien', label: 'SỐ TIỀN', variable: 'recoverableAmount', headerGroup: 'PHÍ CHI HỘ', width: 12, align: 'right', format: 'currency', total: true },
];

const defaultSnapshot: DebitNoteTemplateSnapshot = {
  id: 1, name: 'Mặc định', titleText: 'GIẤY BÁO NỢ',
  issuerName: null, issuerAddress: null, issuerTaxCode: null,
  accentColor: '#1F4E79', showContainerColumn: true, showUnitColumn: true, groupingMode: 'ROUTE',
  columns,
  orientation: 'landscape', termsText: null,
  signatureLeftLabel: 'Khách hàng', signatureLeftName: null,
  signatureRightLabel: 'Kế toán trưởng', signatureRightName: null,
};

const paymentSnapshot: DebitNoteTemplateSnapshot = {
  ...defaultSnapshot,
  titleText: 'BẢNG KÊ CƯỚC VẬN CHUYỂN',
};

// XLSX is a ZIP archive → starts with the PK\x03\x04 magic.
function isXlsx(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

async function loadWorkbook(buf: Buffer) {
  const ExcelJSMod = await import('exceljs');
  const ExcelJS = (ExcelJSMod as Record<string, unknown>).default
    ? ((ExcelJSMod as Record<string, unknown>).default as typeof ExcelJSMod)
    : ExcelJSMod;
  const wb = new ExcelJS.Workbook();
  await (wb.xlsx.load as (data: unknown) => Promise<unknown>)(buf);
  return wb;
}

test('buildBillingXlsx(null template) → valid xlsx for DEBIT_NOTE (legacy path)', async () => {
  const buf = await buildBillingXlsx(debitDoc, null);
  assert.ok(isXlsx(buf), 'should produce a zip/xlsx buffer');
});

test('buildBillingXlsx(null template) → valid xlsx for PAYMENT_STATEMENT legacy fallback', async () => {
  const buf = await buildBillingXlsx(paymentDoc, null);
  assert.ok(isXlsx(buf), 'payment statement fallback should produce a valid xlsx');
});

test('renderTemplatedXlsx with default snapshot → valid xlsx', async () => {
  const buf = await renderTemplatedXlsx(debitDoc, defaultSnapshot);
  assert.ok(isXlsx(buf), 'templated render should produce a valid xlsx');
});

test('renderTemplatedXlsx DEBIT_NOTE writes the debt-note header, not the statement intro', async () => {
  const buf = await renderTemplatedXlsx(debitDoc, defaultSnapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.name, 'GBN');
  assert.equal(ws.pageSetup.orientation, 'portrait');
  assert.equal(ws.getCell(7, 2).value, 'GIẤY BÁO NỢ');
  assert.equal(ws.getCell(9, 5).value, 'Gửi tới:');
  assert.equal(ws.getCell(1, 4).font.name, 'Tahoma');
  assert.equal(ws.getCell(1, 4).font.size, 12);
  assert.equal(ws.getCell(1, 4).alignment.horizontal, 'right');
  assert.equal(ws.getCell(9, 2).font.color?.argb, 'FF969696');
  assert.equal(ws.getRow(6).height, 10.5);
  assert.equal(ws.getRow(8).height, 9);
  assert.equal(ws.getRow(15).height, 28);
  const colAValues = ws.getColumn(1).values.filter((value) => typeof value === 'string') as string[];
  assert.equal(colAValues.some((value) => value.includes('BÊN A')), false);
});

test('renderTemplatedXlsx DEBIT_NOTE normalizes horizontal statement snapshots to vertical columns', async () => {
  const buf = await renderTemplatedXlsx(debitDoc, {
    ...defaultSnapshot,
    columns: defaultPaymentStatementColumns as DebitNoteTemplateColumn[],
    orientation: 'landscape',
  });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(15, 2).value, 'Ngày tháng');
  assert.equal(ws.getCell(15, 3).value, 'Số \nchứng từ');
  assert.equal(ws.getCell(15, 4).value, 'Diễn giải');
  assert.equal(ws.getCell(15, 8).value, 'Thành tiền');
});

test('renderTemplatedXlsx DEBIT_NOTE embeds no image when company has no logo', async () => {
  const buf = await renderTemplatedXlsx(debitDoc, defaultSnapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0] as unknown as { getImages?: () => unknown[] };
  assert.equal((ws.getImages?.() ?? []).length, 0, 'no image should embed when no company logo is configured');
});

test('renderTemplatedXlsx DEBIT_NOTE adds a shipment header row before charge rows', async () => {
  const doc: BillingDocument = {
    ...debitDoc,
    lines: [line({
      unit: "20'",
      renderData: { departureDate: '2026-06-01', containerCount: 1, tripCode: 'TRIP-1' },
    })],
  };
  const buf = await renderTemplatedXlsx(doc, defaultSnapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(16, 4).value, "01x20' ABCD1234567");
  assert.equal(ws.getCell(17, 4).value, 'Cước vận chuyển — HCM - Bình Dương');
  assert.deepEqual(ws.getCell(61, 8).value, { formula: 'SUM(H16:H60)', result: 5_000_000 });
});

test('renderTemplatedXlsx DEBIT_NOTE renders expense documentCode in Số chứng từ', async () => {
  const doc: BillingDocument = {
    ...debitDoc,
    lines: [line({
      sourceType: 'EXPENSE',
      sourceId: 99,
      lineType: 'SERVICE_FEE',
      typeLabel: 'Phí chi hộ',
      unit: "20'",
      description: 'Phí hạ hàng',
      renderData: { departureDate: '2026-06-01', containerCount: 1, tripCode: 'TRIP-1', documentCode: 'HD-001' },
    })],
  };
  const buf = await renderTemplatedXlsx(doc, { ...defaultSnapshot, columns: defaultDebitNoteColumns as DebitNoteTemplateColumn[] });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(17, 3).value, 'HD-001');
});

test('renderTemplatedXlsx DEBIT_NOTE maps legacy chung_tu tripCode columns to documentCode', async () => {
  const legacyColumns: DebitNoteTemplateColumn[] = [
    { id: 'dien_giai', label: 'Diễn giải', variable: 'description', width: 40, align: 'left', format: 'text', total: false },
    { id: 'chung_tu', label: 'Số\nchứng từ', variable: 'tripCode', width: 12, align: 'center', format: 'text', total: false },
    { id: 'amount', label: 'Số tiền', variable: 'amount', width: 16, align: 'right', format: 'currency', total: true },
  ];
  const doc: BillingDocument = {
    ...debitDoc,
    lines: [line({
      sourceType: 'EXPENSE',
      sourceId: 99,
      lineType: 'SERVICE_FEE',
      description: 'Phí hạ hàng',
      renderData: { departureDate: '2026-06-01', tripCode: 'TRIP-1', documentCode: 'TK-123' },
    })],
  };
  const buf = await renderTemplatedXlsx(doc, { ...defaultSnapshot, columns: legacyColumns });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(17, 3).value, 'TK-123');
});

test('renderTemplatedXlsx DEBIT_NOTE renders Long Minh grouped headers, continuation rows, and VAT summary', async () => {
  const doc: BillingDocument = {
    ...debitDoc,
    totalInclVat: 2_500_000,
    lines: [
      line({
        sourceType: 'TRIP',
        sourceId: 1,
        description: 'Cước vận chuyển',
        baseAmount: 2_000_000,
        routeName: 'Cát Lái - Long Minh',
        renderData: {
          tripCode: 'TRIP-1',
          factoryName: 'Nhà máy Long Minh',
          tradeDirectionLabel: 'Nhập',
          billNumber: 'BL-001',
          declarationNumber: 'TK-001',
          quantityLabel: '1 cont 40',
          vehicleType: '40\'',
          truckPlate: '15C-180.99',
          cargoVolumeCbm: 68,
          deliveryDate: '2026-06-15',
          freightAmount: 2_000_000,
        },
      }),
      line({
        sourceType: 'EXPENSE',
        sourceId: 101,
        lineType: 'SERVICE_FEE',
        typeLabel: 'Phí chi hộ',
        description: 'Phí nâng hạ',
        baseAmount: 300_000,
        routeName: 'Cát Lái - Long Minh',
        renderData: {
          tripCode: 'TRIP-1',
          recoverableSupplierName: 'Cảng Cát Lái',
          recoverableFeeType: 'Nâng hạ',
          recoverableDocumentCode: 'HD-101',
          recoverableAmount: 300_000,
        },
      }),
      line({
        sourceType: 'EXPENSE',
        sourceId: 102,
        lineType: 'SERVICE_FEE',
        typeLabel: 'Phí chi hộ',
        description: 'Phí chứng từ',
        baseAmount: 200_000,
        routeName: 'Cát Lái - Long Minh',
        renderData: {
          tripCode: 'TRIP-1',
          recoverableSupplierName: 'Silver Sea',
          recoverableFeeType: 'Chứng từ',
          recoverableDocumentCode: 'HD-102',
          recoverableAmount: 200_000,
        },
        sortOrder: 2,
      }),
    ],
  };
  const snapshot = {
    ...defaultSnapshot,
    titleText: 'BẢNG KÊ XÁC NHẬN VẬN CHUYỂN HOÀN THÀNH / MẪU DEBIT LONG MINH',
    orientation: 'landscape' as const,
    columns: longMinhColumns,
    officialIdentity: {
      issuer: {
        name: 'Silver Sea',
        address: 'Hải Phòng',
        taxCode: '0201985011',
        representative: 'Nguyễn Thị Phương',
        representativeTitle: 'Giám đốc',
        phone: '0976496385',
        bankAccount: '0031000391518',
        bankName: 'Vietcombank',
        email: 'silverseahp@gmail.com',
        logoStorageKey: null,
      },
      counterparty: {
        entityType: 'CUSTOMER' as const,
        name: 'Long Minh',
        address: 'Bắc Ninh',
        taxCode: '2300540419',
        representative: 'Ms.Vân',
        representativeTitle: 'Kế toán',
        phone: '0900000000',
        contactInfo: 'Bắc Ninh',
      },
      signatures: {
        leftLabel: 'Khách hàng',
        leftName: '',
        rightLabel: 'Người lập',
        rightName: 'Nguyễn Thị Phương',
      },
    },
  } satisfies SnapshotWithOfficialIdentity;
  const buf = await renderTemplatedXlsx(doc, snapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.pageSetup.orientation, 'landscape');
  assert.equal(ws.getCell(15, 12).value, 'PHÍ DỊCH VỤ');
  assert.equal(ws.getCell(15, 17).value, 'PHÍ CHI HỘ');
  assert.equal(ws.getCell(16, 20).value, 'SỐ TIỀN');
  assert.equal(ws.getCell(17, 2).value, 'Nhà máy Long Minh');
  assert.equal(ws.getCell(17, 13).value, 2_000_000);
  assert.equal(ws.getCell(17, 17).value, 'Cảng Cát Lái');
  assert.equal(ws.getCell(18, 1).value, null);
  assert.equal(ws.getCell(18, 17).value, 'Silver Sea');
  assert.equal(ws.getCell(18, 20).value, 200_000);
  assert.equal(ws.getCell(20, 20).value, 2_000_000);
  assert.equal(ws.getCell(21, 20).value, 500_000);
  assert.equal(ws.getCell(22, 20).value, 160_000);
  assert.equal(ws.getCell(23, 20).value, 2_660_000);
});

test('renderTemplatedXlsx PAYMENT_STATEMENT resolves template variables in intro text', async () => {
  const buf = await renderTemplatedXlsx({ ...paymentDoc, entityId: 999_999 }, {
    ...paymentSnapshot,
    titleText: 'BẢNG {rangeMonth} - {customerName}',
    termsText: '- Số TK {invoiceNo}\n- Tổng tiền {amountInWords}',
  });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(2, 1).value, 'BẢNG 06.2026 - NCC X');
  assert.match(String(ws.getCell(4, 1).value), /^BÊN A/);
  assert.match(String(ws.getCell(9, 1).value), /^BÊN B/);
  assert.equal(ws.getCell(14, 1).value, '- Số TK ........');
  assert.equal(ws.getCell(15, 1).value, '- Tổng tiền Năm triệu bốn trăm nghìn đồng');
});

test('renderTemplatedXlsx PAYMENT_STATEMENT renders horizontal freight and service-fee variables', async () => {
  const horizontalDoc: BillingDocument = {
    ...paymentDoc,
    lines: [line({
      baseAmount: 5_550_000,
      renderData: {
        freightAmount: 5_000_000,
        serviceFeeAmount: 550_000,
        totalAmount: 5_550_000,
        serviceFeeDescription: 'Nâng hạ',
      },
    })],
  };
  const buf = await renderTemplatedXlsx(horizontalDoc, {
    ...paymentSnapshot,
    columns: [
      { id: 'freight', label: 'Cước vận chuyển', variable: 'freightAmount', width: 16, align: 'right', format: 'currency', total: true },
      { id: 'fee', label: 'Phí chi hộ', variable: 'serviceFeeAmount', width: 16, align: 'right', format: 'currency', total: true },
      { id: 'total', label: 'Tổng tiền', variable: 'totalAmount', width: 16, align: 'right', format: 'currency', total: true },
      { id: 'fee_desc', label: 'Diễn giải phí', variable: 'serviceFeeDescription', width: 24, align: 'left', format: 'text', total: false },
    ],
  });
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(20, 1).value, 5_000_000);
  assert.equal(ws.getCell(20, 2).value, 550_000);
  assert.equal(ws.getCell(20, 3).value, 5_550_000);
  assert.equal(ws.getCell(20, 4).value, 'Nâng hạ');
});

test('renderTemplatedXlsx DEBIT_NOTE prefers persisted official identity over live company and customer data', async () => {
  const frozenSnapshot: SnapshotWithOfficialIdentity = {
    ...defaultSnapshot,
    officialIdentity: {
      issuer: {
        name: 'Công ty phát hành cũ',
        address: '12 Đường Cũ, Hải Phòng',
        taxCode: '0300123456',
        representative: 'Nguyễn Người Cũ',
        representativeTitle: 'Giám đốc',
        phone: '0909123456',
        bankAccount: '001122334455',
        bankName: 'VCB Hải Phòng',
        email: 'old@example.com',
        logoStorageKey: null,
      },
      counterparty: {
        entityType: 'CUSTOMER',
        name: 'Khách hàng lịch sử',
        address: 'Kho Cũ, Quận 7, TP.HCM',
        taxCode: '0311999888',
        representative: 'Trần Kế Toán',
        representativeTitle: 'Kế toán',
        phone: '0909888777',
        contactInfo: 'Kho Cũ, Quận 7, TP.HCM',
      },
      signatures: {
        leftLabel: 'Khách hàng',
        leftName: 'Đại diện khách cũ',
        rightLabel: 'Người lập',
        rightName: 'Người ký cũ',
      },
    },
  };
  const buf = await renderTemplatedXlsx(debitDoc, frozenSnapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell('D1').value, 'Công ty phát hành cũ');
  assert.equal(ws.getCell('D2').value, '12 Đường Cũ');
  assert.equal(ws.getCell('E3').value, 'quận Ngô Quyền, Hải Phòng');
  assert.equal(ws.getCell('E10').value, 'Khách hàng lịch sử');
  assert.equal(ws.getCell('F9').value, 'Trần Kế Toán (0909888777)');
  assert.equal(ws.getCell('E13').value, 'MST : 0311999888');
  assert.equal(ws.getCell(66, 4).value, 'Công ty phát hành cũ');
  assert.equal(ws.getCell(67, 4).value, '001122334455');
  assert.equal(ws.getCell(68, 4).value, 'VCB Hải Phòng');
  assert.equal(ws.getCell(69, 7).value, 'Người ký cũ');
});

test('renderTemplatedXlsx PAYMENT_STATEMENT prefers persisted official identity over live party data', async () => {
  const frozenSnapshot: SnapshotWithOfficialIdentity = {
    ...paymentSnapshot,
    officialIdentity: {
      issuer: {
        name: 'Bên B lịch sử',
        address: '99 Đường Số 1, TP.HCM',
        taxCode: '0311222333',
        representative: 'Phạm Đại Diện',
        representativeTitle: 'Giám đốc',
        phone: '0909555666',
        bankAccount: '99887766',
        bankName: 'ACB Sài Gòn',
        email: 'issuer@example.com',
        logoStorageKey: null,
      },
      counterparty: {
        entityType: 'VENDOR',
        name: 'Nhà cung cấp lịch sử',
        address: 'Bãi cont cũ, Hải Phòng',
        taxCode: '0200444555',
        representative: 'Lê Nhà Cung Cấp',
        representativeTitle: 'Giám đốc',
        phone: '0909444333',
        contactInfo: 'Bãi cont cũ, Hải Phòng',
      },
      signatures: {
        leftLabel: 'Bên A',
        leftName: 'Đại diện A cũ',
        rightLabel: 'Bên B',
        rightName: 'Đại diện B cũ',
      },
    },
  };
  const buf = await renderTemplatedXlsx(paymentDoc, frozenSnapshot);
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell(4, 1).value, 'BÊN A (BÊN THUÊ DỊCH VỤ): Nhà cung cấp lịch sử');
  assert.equal(ws.getCell(5, 1).value, 'Địa chỉ: Bãi cont cũ, Hải Phòng');
  assert.equal(ws.getCell(6, 1).value, 'Mã số thuế: 0200444555');
  assert.equal(ws.getCell(9, 1).value, 'BÊN B (BÊN CUNG CẤP DỊCH VỤ): Bên B lịch sử');
  assert.equal(ws.getCell(10, 1).value, 'Địa chỉ: 99 Đường Số 1, TP.HCM');
  assert.equal(ws.getCell(11, 1).value, 'Mã số thuế: 0311222333');
  assert.equal(ws.getCell(14, 1).value, '- Số TK 99887766');
  assert.equal(ws.getCell(15, 1).value, '- Tại ngân hàng ACB Sài Gòn');
  assert.equal(ws.getCell(30, 1).value, 'Đại diện A cũ');
  assert.equal(ws.getCell(30, 3).value, 'Đại diện B cũ');
});

test('renderTemplatedXlsx with letterhead + terms → valid xlsx', async () => {
  const withChrome: DebitNoteTemplateSnapshot = {
    ...defaultSnapshot,
    issuerName: 'TingTing', issuerAddress: 'TP. HCM', issuerTaxCode: '0123456789',
    termsText: 'Thanh toán trong vòng 30 ngày kể từ ngày nhận giấy báo nợ.',
  };
  const buf = await renderTemplatedXlsx(debitDoc, withChrome);
  assert.ok(isXlsx(buf), 'should still produce a valid xlsx with letterhead/terms');
});

test('renderTemplatedXlsx with toggled-off columns + flat grouping → valid xlsx', async () => {
  const minimal: DebitNoteTemplateSnapshot = {
    ...defaultSnapshot, showContainerColumn: false, showUnitColumn: false, groupingMode: 'NONE',
  };
  const buf = await renderTemplatedXlsx(debitDoc, minimal);
  assert.ok(isXlsx(buf), 'should render 2 columns (desc + amount) with no grouping bands');
});

test('buildBillingXlsx ignores a template whose documentType does not match the doc', async () => {
  const wrongTypeTemplate: DebitNoteTemplate = {
    id: 10, name: 'Wrong', isDefault: false, documentType: 'DEBIT_NOTE',
    titleText: 'GIẤY BÁO NỢ', issuerName: null, issuerAddress: null, issuerTaxCode: null,
    accentColor: '#123456', showContainerColumn: false, showUnitColumn: true,
    groupingMode: 'NONE', columns, amountInWords: false, orientation: 'portrait',
    termsText: null, signatureLeftLabel: 'L', signatureLeftName: null,
    signatureRightLabel: 'R', signatureRightName: null, createdBy: null,
    createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z', deletedAt: null,
  };
  const buf = await buildBillingXlsx(paymentDoc, wrongTypeTemplate);
  assert.ok(isXlsx(buf), 'mismatched template should fall back to legacy xlsx instead of cross-rendering');
});

test('templateToSnapshot — copies render fields', () => {
  const tpl: DebitNoteTemplate = {
    id: 9, name: 'A', isDefault: false, documentType: 'DEBIT_NOTE',
    titleText: 'GN', issuerName: 'Co', issuerAddress: 'Addr', issuerTaxCode: 'MST',
    accentColor: '#123456', showContainerColumn: false, showUnitColumn: true,
    groupingMode: 'NONE', columns, amountInWords: false, orientation: 'portrait',
    termsText: 't', signatureLeftLabel: 'L', signatureLeftName: 'LN',
    signatureRightLabel: 'R', signatureRightName: 'RN', createdBy: null,
    createdAt: '2026-06-30T00:00:00.000Z', updatedAt: '2026-06-30T00:00:00.000Z', deletedAt: null,
  };
  const snap = templateToSnapshot(tpl);
  assert.equal(snap.id, 9);
  assert.equal(snap.titleText, 'GN');
  assert.equal(snap.showContainerColumn, false);
  assert.equal(snap.accentColor, '#123456');
});
