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
 *   3. TRA fallback (r2, QA 08/11): through EVERY live trip of the shipment —
 *      the exact candidate law `expenseTripCandidates` links sources by
 *      (deletedAt NULL, status ≠ CANCELED). Ops 'chi hộ' money rides the
 *      SHARED lot, so the carrier fact is whatever ALL live trips agree on
 *      (entity identity, never the display string); a mixed-carrier lot, a
 *      trip whose carrier does not resolve, or a no-live-trip lot stays
 *      'Chưa xác định'. The unique live trip still carries its id for the
 *      drill-down's bookable grouping; a multi-trip resolution groups under
 *      the synthetic shipment key.
 *   4. The drill-down drops the unconditional trip-less skip: a RESOLVED
 *      trip-less source joins under its party (booking through the unique
 *      live trip when one exists, a display-only shipment row otherwise);
 *      unresolved money keeps no lot row — the summary bucket stays the audit
 *      surface. The money invariant: every source lands in exactly one bucket
 *      and no source is dropped (loop `continue`s only for party mismatch or
 *      a truly-unresolved trip-less source).
 *   5. r6 (owner ruling 09/11): lot-attached money NEVER reads 'Chưa xác
 *      định'. The TRA resolver ends at the LOT's own code (SHP-… / `Lô #<id>`,
 *      partyId null — not a ledger entity); a trip whose carrier does not
 *      resolve falls to that lot party in both loops; money attached to a
 *      SOFT-DELETED lot is excluded from the report wholesale. THU keeps
 *      FB-061 (a soft-deleted customer master never prints; its money keeps
 *      the unknown bucket).
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

  it('TRA fallback resolves through ALL live trips under the all-agree carrier law', () => {
    const fallback = fnBody('resolveShipmentFallbackParties');
    // The exact live predicate expenseTripCandidates links sources by.
    assert.ok(fallback.includes('isNull(s.trips.deletedAt), ne(s.trips.status, \'CANCELED\')'),
      'live trip = deletedAt NULL and not CANCELED');
    assert.ok(fallback.includes("resolveReportTripParties('TRA', allTripIds)"),
      'EVERY live trip rides the SAME TRA case-expression as every trip party');
    // One unresolvable trip never names the bucket.
    assert.ok(fallback.includes('parties.some((party) => party == null)') && fallback.includes('continue'),
      'a trip whose carrier does not resolve keeps the lot in the unknown bucket');
    // All-agree on entity identity — never a display-string guess.
    assert.ok(fallback.includes('parties.every((party): party is ReportPartyInfo => party != null && identityOf(party) === identityOf(first))'),
      'the lot resolves only when every live trip names the same carrier identity');
    assert.ok(fallback.includes('`${party.partyKind ?? \'\'}:${party.partyId ?? \'\'}:${party.name ?? \'\'}\`'),
      'identity = kind + entity id + label (card 201026095604b — never derive-by-string alone)');
    // The unique live trip keeps its id; a multi-trip resolution does not.
    assert.ok(fallback.includes('liveTripId: trips.length === 1 ? trips[0]! : null'),
      'unique live trip stays bookable in the drill-down; multi-trip groups under the shipment key');
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

describe('SIL-729 r4 — the fallback sees fulfillment-linked trips and the lot carrier fact', () => {
  const fallback = fnBody('resolveShipmentFallbackParties');

  it('live trips are read through the fulfillment union, not trips.shipment_id alone', () => {
    // trips.shipment_id is NULLABLE (schema/trips.ts): a trip can link its lot
    // ONLY through fulfillment_id — the same coalesce union every other phoi
    // read uses (card 191026100030). The r2 join missed exactly those lots.
    assert.ok(fallback.includes('coalesce(${s.trips.shipmentId}, ${s.shipmentFulfillments.shipmentId})'),
      'live trips key to their lot via coalesce(trips.shipmentId, fulfillment.shipmentId)');
    assert.ok(fallback.includes('inArray(s.trips.fulfillmentId, fulfillmentIds)'),
      'fulfillment-linked live trips join the candidate set');
    assert.ok(fallback.includes('isNull(s.shipmentFulfillments.canceledAt)'),
      'only live (never-canceled) fulfillments feed both reads');
  });

  it('the lot planned assignment resolves the party when trips cannot', () => {
    // The lot's OWN carrier fact (QA 09/11: '4GS / Chờ bổ sung biển' survives
    // its trip cancel — 0 live trips left, r2 had nothing to all-agree on).
    assert.ok(fallback.includes('plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId'),
      'the external carrier master id comes from the fulfillment plan');
    assert.ok(fallback.includes('plate: s.shipmentFulfillments.plannedVehiclePlateNumber'),
      'the internal fleet fact comes from the planned plate');
    assert.ok(fallback.includes('eq(s.customers.isCarrier, true), isNull(s.customers.deletedAt)'),
      'the external master obeys the FB-061 live-carrier law');
    assert.ok(fallback.includes("identity: `internal::${INTERNAL_CARRIER_CODE}`"),
      'a plated OWN fulfillment names the internal fleet exactly like the trip case-expression');
    assert.ok(fallback.includes('partyKind: \'carrier\''),
      'a fulfillment-resolved external carrier keeps the ledger-side carrier identity');
  });

  it('an unassigned or disagreeing lot never invents a party', () => {
    // 'Chưa phân xe' (plate-less OWN / never planned) poisons the lot.
    assert.ok(fallback.includes("list.push('')"),
      'a fulfillment with no carrier fact never names the bucket');
    // All-agree over fulfillments, same law as the trip branch.
    assert.ok(fallback.includes('!identities.every((identity) => identity === first)'), 'disagreeing assignments keep the bucket');
    assert.ok(fallback.includes('if (map.has(shipmentId)) continue;'),
      'the trip-level all-agree resolution (r2 law) still wins first');
    assert.ok(fallback.includes('liveTripId: null'),
      'a fulfillment-resolved party groups under the synthetic shipment key (no live trip to book)');
  });
});

describe('SIL-729 r6 — lot-attached money never reads the unknown bucket', () => {
  const fallback = fnBody('resolveShipmentFallbackParties');
  const report = fnBody('getPhoiPhieuReport');
  const sources = fnBody('reportSources');

  it('the TRA resolver ends at the lot label — the lot names itself (owner ruling 09/11)', () => {
    assert.ok(fallback.includes('const unresolved = ids.filter((id) => !map.has(id))'),
      'the lot tier fills exactly the shipments both carrier laws left unnamed');
    assert.ok(fallback.includes('code: s.shipments.shipmentCode'),
      'the label is the lot code the owner ruling prescribes');
    assert.ok(fallback.includes('`Lô #${lot.id}`'),
      'a code-less draft lot still prints an honest per-lot label');
    assert.ok(fallback.includes('partyId: null, partyKind: null'),
      'the lot label is not a ledger entity — the payables join can never bind it to a carrier id');
    // The lot tier is TRA-only: it must sit after the THU early return.
    assert.ok(fallback.indexOf('const unresolved = ids.filter') > fallback.indexOf("if (kind === 'THU')"),
      'the THU branch keeps FB-061 untouched (a soft-deleted customer never prints)');
  });

  it('the summary loop falls back to the lot party when a trip names no carrier', () => {
    const loop = report.match(/for \(const source of sources\) \{[\s\S]*?const party = partyInfo\?\.name \?\? 'Chưa xác định';/)?.[0] ?? '';
    assert.notEqual(loop, '', 'the bucket loop must exist');
    assert.ok(loop.includes('resolvedParty?.name != null ? resolvedParty'),
      'a resolved trip party still wins first (r4 pin law unchanged)');
    assert.ok(loop.includes('source.shipmentId != null ? shipmentFallback.get(source.shipmentId)?.party'),
      'the null-name trip falls to the lot party before the unknown bucket');
    assert.ok(report.includes('sources.map((source) => source.shipmentId)'),
      'the fallback map covers every source lot (trip-attached ones included)');
  });

  it('reportSources drops money attached to a soft-deleted lot', () => {
    assert.ok(sources.includes('isNull(s.shipments.deletedAt)'),
      'deleted lot = no report row (owner ruling 09/11)');
    assert.ok(sources.includes('eq(s.shipments.id, s.expenseAccountingSources.shipmentId)'),
      "the exclusion reads the source's own lot id — the trip and paidAt windows alike");
  });
});
