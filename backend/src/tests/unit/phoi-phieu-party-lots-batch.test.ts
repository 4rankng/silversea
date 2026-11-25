/**
 * SIL-916 (KB §6.1/§6.2) — the BATCH drill-down of the "Báo cáo thu / trả phơi"
 * section: "Lập phiếu thu" and "Lập phiếu chi" raise a voucher over EVERY
 * party in the window, so the unpaid-lots read must work WITHOUT a party.
 *
 * Unit pins only (no app boot, no DB — the 2026-10-19 owner ruling, source-scan
 * contract style, precedent: phoi-phieu-shipment-fallback.test.ts). The money
 * law they guard:
 *   1. A party-less read is the batch variant; a party-scoped read stays the
 *      per-party drill-down the report row opens. Same engine, same amounts.
 *   2. The per-source party filter is skipped ONLY when no party was asked
 *      for — a party-scoped read still drops every other party's lots.
 *   3. Every lot row carries the party it belongs to, so the batch worklist
 *      can name whose money the row is (the per-party drawer already knew it
 *      from its title).
 *   4. The route accepts the party-less query (the zod schema must not demand
 *      it).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const service = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/phoi-phieu-control.service.ts'),
  'utf8',
);
const routes = fs.readFileSync(
  path.resolve(process.cwd(), 'src/routes/expense-accounting.ts'),
  'utf8',
);

const fnBody = (name: string): string => {
  const start = service.indexOf(`export async function ${name}`);
  assert.ok(start > -1, `${name} exists`);
  return service.slice(start, service.indexOf('\nexport ', start + 1) > -1 ? service.indexOf('\nexport ', start + 1) : service.length);
};

describe('SIL-916 — the batch drill-down of the phơi phiếu report', () => {
  it('the service reads the party as optional — a party-less query is the batch variant', () => {
    const body = fnBody('getPhoiPhieuPartyLots');
    assert.match(
      body,
      /query: PhoiPhieuReportQuery & \{ party\?: string \| null \}/,
      'the read accepts an absent party',
    );
    assert.match(
      body,
      /const wanted = query\.party\?\.trim\(\) \|\| null;/,
      'a blank party is the batch variant, not an empty-string filter',
    );
  });

  it('the per-source party filter is skipped ONLY for the batch read', () => {
    const body = fnBody('getPhoiPhieuPartyLots');
    assert.match(
      body,
      /if \(wanted !== null && party !== wanted\) continue;/,
      'a party-scoped read still drops every other party; the batch read keeps them all',
    );
    assert.doesNotMatch(body, /if \(party !== wanted\) continue;/, 'the unconditional filter is gone');
  });

  it('every lot row carries its party', () => {
    const body = fnBody('getPhoiPhieuPartyLots');
    assert.match(body, /conLai: 0, party, ghiChu: null/, 'the lot is created with the party it resolved');
  });

  it('CR-011 §10.10.1 — every trip lot carries its controlling plate (own fleet or external)', () => {
    const body = fnBody('getPhoiPhieuPartyLots');
    assert.match(
      body,
      /plateNumber: sql<string \| null>`coalesce\(\$[{]s\.trucks\.licensePlate}, \$[{]s\.tripCarrierInfo\.externalPlateNumber\}\)`/,
      'OWN trips read trucks.licensePlate; external reads tripCarrierInfo.externalPlateNumber',
    );
    assert.match(body, /lot\.plateNumber = identity\.plateNumber \?\? null;/, 'the identity read lands on the lot');
  });

  it('the route accepts the party-less query', () => {
    assert.match(
      routes,
      /party: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(160\)\.optional\(\)/,
      'party is optional on the party-lots endpoint',
    );
  });
});
