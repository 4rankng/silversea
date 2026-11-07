/**
 * SIL-729 — phí trip-less gom 'Chưa xác định': the shipment-level party
 * fallback in phoi-phieu-control.service.ts. PewPie evidence 07/11 (SIL-741,
 * account hoapt): 13 chuyến / 7.418.000₫ reported as 'Phải thu: Chưa xác định
 * | Phải trả: Chưa xác định' because the bucket step only resolved a party
 * through source.tripId — fees attached to the SHIPMENT (tripId NULL) never
 * got a name.
 *
 * Unit pins only (no app boot, no DB — 2026-10-19 owner ruling, source-scan
 * contract style). The money law they guard:
 *   1. The summary bucket consults the shipment fallback BEFORE the unknown
 *      bucket claims a trip-less source; a source with a tripId keeps the
 *      legacy trip-party law untouched.
 *   2. THU fallback: shipment → customer with the FB-061 soft-delete law
 *      (isNull(deletedAt) — a deleted master never prints, its money stays in
 *      the 'Chưa xác định' audit bucket).
 *   3. TRA fallback: through the shipment's UNIQUE live trip — the exact
 *      candidate law `expenseTripCandidates` links sources by (deletedAt NULL,
 *      status ≠ CANCELED); 0 or ≥2 live trips never guess a name.
 *   4. The drill-down drops the unconditional trip-less skip: a RESOLVED
 *      trip-less source joins under its party (booking through the unique
 *      live trip when one exists, a display-only shipment row otherwise);
 *      unresolved money keeps no lot row — the summary bucket stays the audit
 *      surface. The money invariant: every source lands in exactly one bucket
 *      and no source is dropped (loop `continue`s only for party mismatch or
 *      a truly-unresolved trip-less source).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src/services/phoi-phieu-control.service.ts'),
  'utf8',
);

function fnBody(name: string): string {
  // Anchor on the declaration so an earlier prose mention of the name can
  // never truncate the body at the wrong column-0 brace.
  const match = source.match(new RegExp(`(export )?async function ${name}\\([\\s\\S]*?\\n}`));
  assert.notEqual(match?.[0], undefined, `${name} must exist`);
  return match?.[0] ?? '';
}

describe('SIL-729 — the summary bucket resolves through the shipment fallback', () => {
  const report = fnBody('getPhoiPhieuReport');

  it('the fallback resolver feeds the bucket step for trip-less sources', () => {
    assert.ok(report.includes('resolveShipmentFallbackParties(query.kind'), 'summary must build the fallback map');
    const loop = report.match(/for \(const source of sources\) \{[\s\S]*?const party = partyInfo\?\.name \?\? 'Chưa xác định';/)?.[0] ?? '';
    assert.notEqual(loop, '', 'the bucket loop must exist');
    assert.ok(loop.includes('source.tripId != null ? tripParty.get(source.tripId)'), 'trip sources keep the legacy law');
    assert.ok(loop.includes('shipmentFallback.get(source.shipmentId)?.party'), 'trip-less sources consult the fallback before the unknown bucket');
  });

  it('THU fallback reads the customer with the FB-061 soft-delete law', () => {
    const fallback = fnBody('resolveShipmentFallbackParties');
    assert.ok(fallback.includes('leftJoin(s.customers, and(eq(s.customers.id, s.shipments.customerId), isNull(s.customers.deletedAt)))'),
      'a soft-deleted customer master never prints (FB-061)');
    assert.ok(fallback.includes('operationalName(s.customers.shortName, s.customers.name)'), 'THU party keeps the operational label law');
  });

  it('TRA fallback resolves through the UNIQUE live trip — the link candidate law', () => {
    const fallback = fnBody('resolveShipmentFallbackParties');
    // The exact live predicate expenseTripCandidates links sources by.
    assert.ok(fallback.includes('isNull(s.trips.deletedAt), ne(s.trips.status, \'CANCELED\')'),
      'live trip = deletedAt NULL and not CANCELED');
    assert.ok(fallback.includes('trips.length === 1'), 'exactly one live trip resolves; 0 or ≥2 stay unresolved');
    assert.ok(fallback.includes("resolveReportTripParties('TRA', uniqueTripIds)"),
      'the unique trip rides the SAME TRA case-expression as every trip party');
  });
});

describe('SIL-729 — the drill-down shows resolved trip-less money', () => {
  const lots = fnBody('getPhoiPhieuPartyLots');

  it('no unconditional trip-less skip — a resolved trip-less source joins its party', () => {
    const loop = lots.match(/for \(const source of sources\) \{[\s\S]*?lots\.set\(lotKey, lot\);\n    \}\n/)?.[0] ?? '';
    assert.notEqual(loop, '', 'the drill-down loop must exist');
    assert.ok(!loop.includes('if (source.tripId == null) continue;'), 'the old unconditional skip is gone');
    assert.ok(loop.includes('shipmentFallback.get(source.shipmentId)'), 'the loop consults the fallback');
    assert.ok(loop.includes(`'Chưa xác định'`) === false || loop.includes("(partyInfo?.name ?? 'Chưa xác định') !== wanted"),
      'the party label must match the summary exactly');
    // Unresolved money still keeps no lot row — the summary bucket stays the
    // audit surface (FB-061); the only continues are the label mismatch and
    // the null lot key.
    assert.ok(loop.includes('if (lotKey == null) continue;'), 'unresolved trip-less money keeps no lot row');
    assert.ok(loop.includes('tripId: lotKey > 0 ? lotKey : null'), 'a shared shipment fee lot is display-only (tripId null)');
  });

  it('shipment-keyed lots read their identity from the shipment row', () => {
    assert.ok(lots.includes('.from(s.shipments).where(inArray(s.shipments.id, sharedIds))'),
      'shared lots fetch bill/booking from the shipment directly');
    assert.ok(lots.includes('(a.tripId ?? Number.MAX_SAFE_INTEGER) - (b.tripId ?? Number.MAX_SAFE_INTEGER)'),
      'the sort never arithmetic on a null tripId');
  });
});
