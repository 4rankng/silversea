// Card 20260928_177 — the customers-screen debt projection contract.
//
// "Bỏ xe công ty" must never be a client-side subtraction: the export has to
// show the same number, so the figures come from `GET /customers/debt-summary`
// with `excludeOwnFleet`, recomputed by the server under the same filter. The
// response type lives HERE rather than in `shared/src/schemas` because another
// lane owns that file this run; it mirrors the backend service's contract
// (backend/src/services/customer-debt-summary.service.ts).

/** One shipment/trip line: `ownership` is the own-vehicle axis
 *  ('OWN' = xe công ty / xe nhà), `carrierKey` the debit-settlement identity
 *  ('OWN' | 'CUST:<id>' | 'PLATE:<plate>' | 'UNKNOWN'). */
export interface CustomerFreightLineResponse {
  shipmentId: number;
  tripId: number;
  shipmentCode: string | null;
  ownership: 'OWN' | 'EXTERNAL';
  carrierKey: string;
  freightRevenue: number;
  freightPayable: number;
}

export interface CustomerFreightRowResponse {
  customerId: number;
  customerName: string | null;
  customerShortName: string | null;
  tripCount: number;
  freightRevenue: number;
  freightPayable: number;
  ownFleetTripCount: number;
  ownFleetFreightRevenue: number;
  ownFleetFreightPayable: number;
  lines: CustomerFreightLineResponse[];
}

export interface CustomerDebtSummaryResponse {
  filter: { from: string | null; to: string | null; excludeOwnFleet: boolean; customerIds: number[] | null };
  items: CustomerFreightRowResponse[];
  totals: {
    tripCount: number;
    freightRevenue: number;
    freightPayable: number;
    ownFleetTripCount: number;
    ownFleetFreightRevenue: number;
    ownFleetFreightPayable: number;
  };
}

/** The request the tick produces — ON/OFF maps 1:1 to the SERVER filter. */
export function customerDebtSummaryQuery(customerIds: number[], excludeOwnFleet: boolean): string {
  const params = new URLSearchParams({ customerIds: customerIds.join(',') });
  if (excludeOwnFleet) params.set('excludeOwnFleet', 'true');
  return `?${params.toString()}`;
}

/** The figures the table renders: read verbatim off the server response, never
 *  recomputed locally — the tick already changed them server-side. */
export function customerFreightMap(
  summary: CustomerDebtSummaryResponse | undefined,
): Map<number, CustomerFreightRowResponse> {
  return new Map((summary?.items ?? []).map((row) => [row.customerId, row]));
}
