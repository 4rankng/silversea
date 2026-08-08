# Seed Data from Excel Files

This system generates seed data for staging and local development from Excel files in the Google Drive `2. Raw_data` folder.

## Overview

The raw Excel data is located at:
```
/Users/dev/My Drive/SilverSea/2. Raw_data/
```

The main data file is `29.7 - DATA PM.xlsx` which contains:
- **THÔNG TIN NCC** - Supplier information (LONG MINH customer data)
- **NHÀ MÁY** - Factory/warehouse locations (8 factories)
- **LOẠI HÌNH XE** - Vehicle/truck data (3 vehicles)
- **THÔNG TIN CẢNG BÃI** - Port/terminal data (17 ports)
- **MẪU BÁO GIÁ** - Pricing data
- **DS NHÂN SỰ** - Personnel data

## Usage

### 1. Generate Seed Data from Excel

Extract data from Excel files and convert to TypeScript:

```bash
pnpm seed:generate
```

This creates/updates:
- `backend/src/seed/data/factories.ts` - Factory/warehouse data
- `backend/src/seed/data/vehicles.ts` - Vehicle/truck data
- `backend/src/seed/data/ports.ts` - Port/terminal data

### 2. Run Database Seed

Apply the seed data to the database:

```bash
cd backend
pnpm seed
```

This will populate your staging/local database with:
- Users (admin, dispatcher, drivers, etc.)
- Customers and suppliers
- Trucks and trailers
- Drivers with vehicle assignments
- Ports and terminals
- Factories and warehouses
- Pricing tables
- Sample shipments

## Files

### Tools

- **`tools/generate-seed-data.mjs`** - Main generator that extracts data from Excel and generates TypeScript files
- **`tools/extract-excel-data.mjs`** - Utility to inspect Excel file structure

### Seed Modules

- **`backend/src/seed/seed-factories.ts`** - Seeds factory/warehouse data
- **`backend/src/seed/seed-ports.ts`** - Seeds port/terminal data
- **`backend/src/seed/seed-vehicles-from-excel.ts`** - Seeds vehicle data with driver links

### Data Files

Generated TypeScript data files (auto-generated, do not edit manually):
- **`backend/src/seed/data/factories.ts`**
- **`backend/src/seed/data/vehicles.ts`**
- **`backend/src/seed/data/ports.ts`**

## Test Accounts

After seeding, you can login with these accounts:

| Username | Password | Role | Description |
|----------|----------|------|-------------|
| admin | Abc123 | ADMIN | Administrator |
| giamdoc | Abc123 | MANAGER | Manager |
| ketoan | Abc123 | ACCOUNTANT | Accountant |
| cus | Abc123 | CUS | Customer Service (demo scope) |
| dieuvan | Abc123 | DISPATCHER | Dispatcher |
| giaonhan | Abc123 | OPS | Operations/Forwarding |
| laixe | Abc123 | DRIVER | Driver 1 |
| customer | Abc123 | CUSTOMER | Customer portal user |

## Regenerating Data

When Excel files change:

1. Run `pnpm seed:generate` to regenerate TypeScript files
2. Run `pnpm --dir backend seed` to apply to database

The seed functions are idempotent - running them multiple times is safe and will update existing data without creating duplicates.

## Customer Data Structure

The LONG MINH customer data includes:
- **Factories**: 8 locations (NEWEB warehouses 1-3, ASKEY workshops 1-2, SUNRISE, SJ TECH, SCONNECT)
- **Vehicles**: 3 truck/trailer combinations with assigned drivers
- **Ports**: 17 Hải Phòng area ports and terminals

## Adding New Data

1. **Add to Excel**: Update the relevant sheet in `29.7 - DATA PM.xlsx`
2. **Regenerate**: Run `pnpm seed:generate`
3. **Verify**: Check the generated TypeScript files in `backend/src/seed/data/`
4. **Seed**: Run `pnpm --dir backend seed`

The data extraction maps Excel columns to TypeScript interfaces - see `tools/generate-seed-data.mjs` for the mapping logic.
