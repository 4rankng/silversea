// testplan/qa/lib/fixtures.mjs — data-driven fixture pickers shared by cases.
//
// A case must never pick its subject by POSITION ("the first row of
// /shipments"). Earlier cases in a run create throwaway lots with zero
// containers, and those land at the top of the workboard: the drawer then
// renders `<p class="cus-detail-empty">Lô hàng chưa có dữ liệu container.</p>`
// and a ledger assertion reports a FAIL for a row nobody chose. Cases pick by
// PROPERTY instead — here, "a lot that actually has containers" — and return
// BLOCKED (never FAIL) when the env under test holds no such lot.

/**
 * The workboard's own search vocabulary (shared/src/schemas/
 * cus-shipment-workspace.ts:26 — `CUS_SEARCH_PATTERN`). A ref the workboard
 * refuses to filter on is not a usable fixture handle, so the picker validates
 * the token it derives against the same rule instead of trusting the DB.
 */
const SEARCHABLE_REF = /^[A-Za-z0-9 ./-]{4,64}$/;

/** Widest rows-per-page the workboard itself offers (SHIPMENT_CUS_PAGE_SIZES). */
const WIDEST_PAGE = 200;

/** Pages of `/shipments` scanned before the picker gives up. */
const MAX_SCAN_PAGES = 4;

function firstSearchableRef(detail) {
  const summary = detail?.summary ?? {};
  const candidates = [
    summary.billOrBookNumber,
    summary.declarationNumber,
    ...(summary.declarationNumbers ?? []),
    ...(detail?.containers ?? []).map((line) => line.containerNumber),
  ];
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (SEARCHABLE_REF.test(value)) return value;
  }
  return null;
}

/**
 * Find a lot that HAS containers and a ref the workboard can filter on.
 *
 * Returns `{ id, ref, containerCount }`, or `null` when the env holds no such
 * lot — the caller reports BLOCKED naming `ctx.env.env`.
 *
 * @param {object} ctx  harness session (apiGet, env)
 */
export async function pickContainerBearingShipment(ctx) {
  // 1. Which lots have containers? `/shipments` carries `containerCount` /
  //    `containerTotal` on every row, so no DB access is needed.
  const candidates = [];
  for (let page = 1; page <= MAX_SCAN_PAGES; page += 1) {
    const res = await ctx.apiGet(`/shipments?limit=100&page=${page}`);
    const items = Array.isArray(res.body?.items) ? res.body.items : [];
    if (items.length === 0) break;
    for (const item of items) {
      const count = item.containerTotal ?? item.containerCount ?? 0;
      if (count > 0) candidates.push({ id: item.id, containerCount: count });
    }
  }
  if (candidates.length === 0) return null;

  // 2. A container-bearing lot is only reachable on the workboard if some ref
  //    on it matches the search filter. Take the first candidate that has one
  //    AND whose row survives the filter on page 1.
  for (const candidate of candidates) {
    const detail = await ctx.apiGet(`/shipments/cus-workspace/${candidate.id}`);
    if (detail.status !== 200) continue;
    const ref = firstSearchableRef(detail.body);
    if (ref == null) continue;

    const filtered = await ctx.apiGet(
      `/shipments/cus-workspace?page=1&limit=${WIDEST_PAGE}&searchSuffix=${encodeURIComponent(ref)}`,
    );
    const items = Array.isArray(filtered.body?.items) ? filtered.body.items : [];
    if (items.length > WIDEST_PAGE) continue;
    if (!items.some((item) => item.id === candidate.id)) continue;

    return { ...candidate, ref };
  }
  return null;
}
