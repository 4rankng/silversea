import { sql } from 'drizzle-orm';
import * as s from '../db/schema';

// SIL-683 — completion business date law. `trips.completed_at` and the
// `trips_composite` twin are naive timestamps holding UTC wall clock (the
// recoverable-cost precedent), so the UTC→VN chain is the ONLY session-proof
// rendering: a single `at time zone 'Asia/Ho_Chi_Minh'` INTERPRETS UTC wall
// time as +07 and shifts early-morning completions a day early. The ::date /
// to_char forms stay tz-stable because the chain ends in a naive VN timestamp.
//
// Deliberately db-free (drizzle sql + schema types only) so unit tests can
// render the real chunks without booting a pool — the same seam
// cus-workspace-sql.service.ts provides. re-exported from reporting-shared.

/** Official trip financial reporting anchors to the Vietnam business date of
 * trip completion, not the trip's operational departure date (::date form). */
export function tripCompletionBusinessDateSql() {
  return sql<string>`(${s.trips.completedAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`;
}

/** 'YYYY-MM-DD' text twin — register / billing-draft / invariants projections. */
export const tripCompletionBusinessDateTextSql = sql<string>`to_char(${s.trips.completedAt} at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`;

/** trips_composite text twin — billing-draft projections over the view. */
export const tripCompletionBusinessDateCompositeTextSql = sql<string>`to_char(${s.tripsComposite.completedAt} at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`;

/** trips_composite ::date twin — billing-draft range filters over the view. */
export const tripCompletionBusinessDateCompositeDateSql = sql<string>`(${s.tripsComposite.completedAt} at time zone 'UTC' at time zone 'Asia/Ho_Chi_Minh')::date`;
