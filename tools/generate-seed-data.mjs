#!/usr/bin/env node
/**
 * Generate seed data from Excel files for staging/local development
 * Run with: node tools/generate-seed-data.mjs
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DATA_DIR = '/Users/dev/My Drive/SilverSea/2. Raw_data';
const OUTPUT_DIR = path.join(__dirname, '../backend/src/seed/data');
const DATA_PM_FILE = path.join(RAW_DATA_DIR, '29.7 - DATA PM.xlsx');

function parseExcelHeaders(row) {
  const headers = [];
  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === 'string' && value.trim()) {
      headers.push({ key, value: value.trim() });
    }
  }
  return headers;
}

function extractDataRows(data, headerRowIndex = 0) {
  if (data.length <= headerRowIndex + 1) return [];

  const headerRow = data[headerRowIndex];
  const headers = parseExcelHeaders(headerRow);

  const result = [];
  for (let i = headerRowIndex + 1; i < data.length; i++) {
    const row = data[i];
    if (!row || Object.values(row).every(v => v === null || v === '')) continue;

    const obj = {};
    for (const header of headers) {
      obj[header.value] = row[header.key] ?? null;
    }
    result.push(obj);
  }
  return result;
}

function extractSupplierData(data) {
  // THÔNG TIN NCC sheet - skip first row (headers), data starts from row 2
  const rows = extractDataRows(data, 0);

  // Map columns to fields
  return rows
    .filter(row => row['STT'] && typeof row['STT'] === 'number')
    .map(row => ({
      internalCode: row['MÃ NỘI BỘ']?.trim() || '',
      taxCode: String(row['MST'] || '').trim(),
      name: row['TÊN KHÁCH HÀNG']?.trim() || '',
      address: row['ĐỊA CHỈ']?.trim() || '',
      email: row['GMAIL']?.trim() || '',
      directorPhone: row['SĐT Giám đốc']?.trim() || '',
      paymentTermChiHoDays: row['HẠN THANH TOÁN CHI HỘ'] || null,
      paymentTermCuocDays: row['HẠN THANH TOÁN CƯỚC'] || null,
      manager: row['QUẢN LÝ']?.trim() || '',
    }));
}

function extractFactoryData(data) {
  // NHÀ MÁY sheet
  const rows = extractDataRows(data, 0);

  return rows
    .filter(row => row['STT'] && typeof row['STT'] === 'number')
    .map(row => ({
      internalCode: row['MÃ NỘI BỘ']?.trim() || '',
      name: row['NHÀ MÁY']?.trim() || '',
      address: row['ĐỊA CHỈ']?.trim() || '',
      taxCode: row['MST NÂNG HẠ']?.trim() || '',
      note: row['LƯU Ý']?.trim() || '',
      locationUrl: row['ĐỊNH VỊ KHO']?.trim() || '',
    }));
}

function extractVehicleData(data) {
  // LOẠI HÌNH XE sheet - complex structure with merged cells
  const rows = extractDataRows(data, 0);

  return rows
    .filter(row => row['Loại hình xe'] && row['Loại hình xe'].trim())
    .map(row => ({
      type: row['Loại hình xe']?.trim() || '',
      licensePlate: row['BKS']?.trim() || '',
      trailerPlate: row['Ro-mooc']?.trim() || '',
      inspectionDeadline: row['HẠN ĐĂNG KIỂM'] || null,
      driver: row['Tài xế']?.trim() || '',
      licenseDeadline: row['HẠN GPLX'] || null,
      maxLoadTon: row['Tải trọng tối đa ( Tấn )'] || null,
      maxLoadFront: row['Tải trọng tối đa đặt đầu ( Tấn )'] || null,
      maxLoadRear: row['Tải trọng tối đa đặt đuôi (Tấn )'] || null,
      preferredRoute: row['Tuyến đường ưu tiên']?.trim() || '',
      note: row['Ghi chú']?.trim() || '',
    }));
}

function extractPortData(data) {
  // THÔNG TIN CẢNG BÃI sheet
  const rows = extractDataRows(data, 0);

  return rows
    .filter(row => row['TÊN CẢNG'] && row['TÊN CẢNG'].trim())
    .map(row => ({
      name: row['TÊN CẢNG']?.trim() || '',
      address: row['ĐỊA CHỈ']?.trim() || '',
      operationUrl: row['LINK WEB THỰC HIỆN TÁC NGHIỆP']?.trim() || '',
      liftingFee: row['CHI PHÍ NÂNG HẠ TẠI CẢNG (GIÁ THAM KHẢO)']?.trim() || '',
    }));
}

function extractPricingData(data) {
  // MẪU BÁO GIÁ sheet
  const rows = extractDataRows(data, 0);

  return rows
    .filter(row => row['KHÁCH HÀNG LONG MINH'] && row['KHÁCH HÀNG LONG MINH'].trim() && row['KHÁCH HÀNG LONG MINH'] !== '海防-NEWEB')
    .map(row => ({
      route: row['KHÁCH HÀNG LONG MINH']?.trim() || '',
      distance: row['KM'] || null,
      roundTrip: row['2 CHIỀU'] || null,
      fuelNormPerKm: row['ĐỊNH MỨC DẦU /KM'] || null,
      totalLitersPerTrip: row['TỔNG LÍT DẦU / CHUYẾN'] || null,
      basePrice: row['GIÁ GỐC '] || null,
      cosSharePrice: row['chia sẻ tính 2% GIÁ COS'] || null,
      totalPrice: row['CƯỚC GỒM PHỤ PHÍ'] || null,
      surcharge: row['PHỤ PHÍ THU'] || null,
    }));
}

function main() {
  console.log('📊 Generating seed data from Excel files...\n');

  if (!fs.existsSync(DATA_PM_FILE)) {
    console.error(`❌ Data file not found: ${DATA_PM_FILE}`);
    process.exit(1);
  }

  const workbook = XLSX.readFile(DATA_PM_FILE);
  console.log(`📖 Reading: ${path.basename(DATA_PM_FILE)}`);
  console.log(`   Sheets: ${workbook.SheetNames.join(', ')}\n`);

  // Extract data from each sheet
  const result = {};

  if (workbook.SheetNames.includes('THÔNG TIN NCC')) {
    const sheet = workbook.Sheets['THÔNG TIN NCC'];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: null });
    result.suppliers = extractSupplierData(data);
    console.log(`✅ THÔNG TIN NCC: ${result.suppliers.length} rows`);
  }

  if (workbook.SheetNames.includes('NHÀ MÁY')) {
    const sheet = workbook.Sheets['NHÀ MÁY'];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: null });
    result.factories = extractFactoryData(data);
    console.log(`✅ NHÀ MÁY: ${result.factories.length} rows`);
  }

  if (workbook.SheetNames.includes('LOẠI HÌNH XE')) {
    const sheet = workbook.Sheets['LOẠI HÌNH XE'];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: null });
    result.vehicles = extractVehicleData(data);
    console.log(`✅ LOẠI HÌNH XE: ${result.vehicles.length} rows`);
  }

  if (workbook.SheetNames.includes('THÔNG TIN CẢNG BÃI')) {
    const sheet = workbook.Sheets['THÔNG TIN CẢNG BÃI'];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: null });
    result.ports = extractPortData(data);
    console.log(`✅ THÔNG TIN CẢNG BÃI: ${result.ports.length} rows`);
  }

  if (workbook.SheetNames.includes('MẪU BÁO GIÁ')) {
    const sheet = workbook.Sheets['MẪU BÁO GIÁ'];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: null });
    result.pricing = extractPricingData(data);
    console.log(`✅ MẪU BÁO GIÁ: ${result.pricing.length} rows`);
  }

  // Generate TypeScript files
  console.log('\n📝 Generating TypeScript seed files...\n');

  // Generate factories data
  if (result.factories && result.factories.length > 0) {
    const factoriesTs = `// AUTO-GENERATED from ${DATA_PM_FILE} - NHÀ MÁY sheet
// Run: node tools/generate-seed-data.mjs to regenerate

export interface FactorySeed {
  internalCode: string;
  name: string;
  address: string;
  taxCode: string;
  note: string;
  locationUrl: string;
}

export const factories: FactorySeed[] = ${JSON.stringify(result.factories, null, 2)};
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'factories.ts'), factoriesTs);
    console.log(`✅ Generated: factories.ts (${result.factories.length} factories)`);
  }

  // Generate vehicles data
  if (result.vehicles && result.vehicles.length > 0) {
    const vehiclesTs = `// AUTO-GENERATED from ${DATA_PM_FILE} - LOẠI HÌNH XE sheet
// Run: node tools/generate-seed-data.mjs to regenerate

export interface VehicleSeed {
  type: string;
  licensePlate: string;
  trailerPlate: string;
  inspectionDeadline: string | null;
  driver: string;
  licenseDeadline: string | null;
  maxLoadTon: number | null;
  maxLoadFront: number | null;
  maxLoadRear: number | null;
  preferredRoute: string;
  note: string;
}

export const vehicles: VehicleSeed[] = ${JSON.stringify(result.vehicles, null, 2)};
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'vehicles.ts'), vehiclesTs);
    console.log(`✅ Generated: vehicles.ts (${result.vehicles.length} vehicles)`);
  }

  // Generate ports data
  if (result.ports && result.ports.length > 0) {
    const portsTs = `// AUTO-GENERATED from ${DATA_PM_FILE} - THÔNG TIN CẢNG BÃI sheet
// Run: node tools/generate-seed-data.mjs to regenerate

export interface PortFromExcelSeed {
  name: string;
  address: string;
  operationUrl: string;
  liftingFee: string;
}

export const ports: PortFromExcelSeed[] = ${JSON.stringify(result.ports, null, 2)};
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'ports-from-excel.ts'), portsTs);
    console.log(`✅ Generated: ports-from-excel.ts (${result.ports.length} ports)`);
  }

  // Generate pricing data
  if (result.pricing && result.pricing.length > 0) {
    const pricingTs = `// AUTO-GENERATED from ${DATA_PM_FILE} - MẪU BÁO GIÁ sheet
// Run: node tools/generate-seed-data.mjs to regenerate

export interface PricingSeed {
  route: string;
  distance: number | null;
  roundTrip: number | null;
  fuelNormPerKm: number | null;
  totalLitersPerTrip: number | null;
  basePrice: number | null;
  cosSharePrice: number | null;
  totalPrice: number | null;
  surcharge: number | null;
}

export const longMinhPricing: PricingSeed[] = ${JSON.stringify(result.pricing, null, 2)};
`;

    fs.writeFileSync(path.join(OUTPUT_DIR, 'long-minh-pricing.ts'), pricingTs);
    console.log(`✅ Generated: long-minh-pricing.ts (${result.pricing.length} routes)`);
  }

  console.log('\n✨ Seed data generation complete!');
  console.log(`📂 Output directory: ${OUTPUT_DIR}`);
}

main();
