/**
 * DRI-01 (card 211026130743) — the admin trip detail's SĐT kho/nhà máy.
 *
 * GET /api/trips/:id attaches the F6 factory-site view; the trip-detail FE
 * renders its contact phone as the house TelLink. The phone must ALWAYS read
 * the LIVE master-data site — even on SNAPSHOT-sourced trips (only name and
 * address are frozen at dispatch) — so the admin dials the current number,
 * exactly like the driver channel's SĐT kho (driver.service site join).
 *
 * Pure unit test (owner ruling 2026-10-19): the service module imports the db
 * handle, so the pin is a static source scan of the owner files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const serviceSource = readFileSync(
  path.resolve(import.meta.dirname, '../../services/trip-factory-site.service.ts'),
  'utf8',
);
const sharedTypesSource = readFileSync(
  path.resolve(import.meta.dirname, '../../../../shared/src/types/index.ts'),
  'utf8',
);

test('DRI01-1: the factory-site resolution reads the site contact pair alongside name/address', () => {
  assert.ok(
    serviceSource.includes('siteContactName: s.operationalSites.contactName')
      && serviceSource.includes('siteContactPhone: s.operationalSites.contactPhone'),
    'the site select must carry contactName + contactPhone',
  );
  assert.ok(
    serviceSource.includes('interface FactorySiteContact'),
    'the contact pair is a named part of the view contract',
  );
});

test('DRI01-2: the SNAPSHOT branch attaches the LIVE contact (never a frozen phone)', () => {
  // Only name/address freeze at dispatch; the snapshot return must resolve
  // contactName/contactPhone from the live `resolved` site read.
  const branchStart = serviceSource.indexOf('if (trip.factorySiteName != null');
  assert.ok(branchStart > -1, 'the snapshot branch exists');
  const snapshotBranch = serviceSource.slice(
    branchStart,
    serviceSource.indexOf("source: 'SNAPSHOT'", branchStart),
  );
  assert.match(snapshotBranch, /contactName: resolved\?\.contactName \?\? null/);
  assert.match(snapshotBranch, /contactPhone: resolved\?\.contactPhone \?\? null/);
});

test('DRI01-3: the resolution runs BEFORE the snapshot branch (shipment exists → live read)', () => {
  const resolveCall = serviceSource.indexOf('await resolveDispatchFactorySnapshot(executor, {');
  const snapshotBranch = serviceSource.indexOf("if (trip.factorySiteName != null");
  assert.ok(resolveCall > -1 && snapshotBranch > resolveCall,
    'getTripFactorySiteView must resolve the live site before returning the SNAPSHOT view');
});

test('DRI01-4: the shared TripDetail contract carries the factorySite view with the phone', () => {
  assert.match(
    sharedTypesSource,
    /factorySite\?:\s*\{[\s\S]*?contactPhone: string \| null;[\s\S]*?\} \| null;/,
    'TripDetail.factorySite must be optional with contactPhone: string | null',
  );
});
