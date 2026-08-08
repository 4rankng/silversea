#!/usr/bin/env node
/**
 * Excel data extraction tool for seed data generation
 * Run with: node tools/extract-excel-data.mjs
 */

import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DATA_DIR = '/Users/dev/My Drive/SilverSea/2. Raw_data';
const OUTPUT_DIR = path.join(__dirname, '../backend/src/seed/data');

function extractExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath);
  const result = {};

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: null });
    result[sheetName] = data;
  }

  return result;
}

function main() {
  console.log('📊 Extracting Excel data from:', RAW_DATA_DIR);
  console.log('');

  // List all Excel files
  const files = fs.readdirSync(RAW_DATA_DIR).filter(f => f.endsWith('.xlsx'));

  console.log('Found Excel files:');
  for (const file of files) {
    console.log(`  - ${file}`);
  }
  console.log('');

  // Extract each file
  for (const file of files) {
    const filePath = path.join(RAW_DATA_DIR, file);
    console.log(`📖 Extracting: ${file}`);

    try {
      const data = extractExcelFile(filePath);

      console.log(`  Sheets: ${Object.keys(data).join(', ')}`);

      for (const [sheetName, sheetData] of Object.entries(data)) {
        console.log(`    ${sheetName}: ${sheetData.length} rows`);

        // Show first few rows as preview
        if (sheetData.length > 0) {
          console.log(`      Sample:`, JSON.stringify(sheetData.slice(0, 2), null, 2));
        }
      }
    } catch (error) {
      console.error(`  ❌ Error:`, error.message);
    }

    console.log('');
  }
}

main();
