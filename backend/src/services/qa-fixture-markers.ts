/**
 * FB-061 (card 141026012010) — the single owner of the QA-fixture marker
 * signatures, shared by BOTH sides of the class:
 *
 *   1. `listPhoiPhieuRows` (the production-facing board read) — a row whose
 *      shipment / factory / vehicle / carrier / driver / party carries a
 *      marker is never listed, so the class cannot reach the screen even
 *      before a purge has run;
 *   2. `seed/qa-fixture-registry.ts` (the purge) — the same signatures are
 *      turned into raw-SQL predicates there.
 *
 * Before this module the signatures were written twice and DRIFTED: the
 * registry's `QA_TRIPS_SQL` still carried the pre-FB-061 shipment list, so
 * the trips hanging off a `BL-QAKE-*` / `E2E-*` lot were never purged while
 * their shipment was — a class that reappeared on every wave.
 *
 * Design rules (each one earned by a real false positive):
 *
 * - Every marker is `ILIKE` on a QA/probe TOKEN, or the run-scoped epoch
 *   signature `-<10..13 digits>$` / `-<13 digits>-` that every QA lane's
 *   `<purpose>-<epoch>-<rand>` naming produces. No branch can match a real
 *   bill, plate, driver or site name.
 * - `STG VERIFY%` is a declared FIXTURE PARTY family (the QA staging carrier
 *   lane), NOT a phrase about "nhà xe". It is deliberately a whole-prefix
 *   match on `STG VERIFY%` and never a bare `NHA XE`: the live roster has
 *   real carriers such as `CÔNG TY TNHH VẬN TẢI NHA XE BIEN BAC`, and a bare
 *   `NHA XE` branch would hide real revenue rows.
 * - NULL never matches: every comparison is wrapped in `coalesce(col, '')`
 *   so an absent value cannot poison a negation (`NOT NULL` is NULL, which
 *   would silently drop every row with an empty optional column).
 */

import { SQL, sql, type SQLWrapper } from 'drizzle-orm';
import * as s from '../db/schema';

/**
 * Run-scoped signature shared by every QA lane: `<purpose>-<epoch ms>-<rand>`.
 * A real plate, container or factory name never carries a 10..13 digit stamp.
 */
export const QA_EPOCH_SUFFIX_REGEX = '-[0-9]{10,13}$';
export const QA_EPOCH_MIDFIX_REGEX = '-[0-9]{13}-';

/** Business references (Bill / Booking / Mã lô / ghi chú vận hành). */
export const QA_REFERENCE_PREFIXES = [
  'QA%', 'BL-QAKE%', 'E2E-%', 'CARD226-QA-%', 'BILL-QAC1%',
] as const;
export const QA_NOTES_PREFIXES = [
  'QA-BUG3%', 'card226 advisory-lock probe%',
] as const;
/** Vehicle plates: QA lane prefix + the two probe plates the card quotes. */
export const QA_PLATE_PREFIXES = ['QA%', '99T-99999', '51K-PROBE%'] as const;
/** Person names on the board (external driver / own-fleet driver). */
export const QA_PERSON_PREFIXES = ['QA%', 'Test Driver%'] as const;
/** Customer / supplier display names. `STG VERIFY%` is the fixture carrier
 *  family; a bare `NHA XE` branch is forbidden (real carriers share it). */
export const QA_PARTY_PREFIXES = ['QA%', 'STG VERIFY%'] as const;
/** Factory / operational-site names and site codes. */
export const QA_SITE_PREFIXES = ['QA%', 'KHO-SEAM%'] as const;

type MarkerSpec = {
  /** Drizzle columns compared against the prefixes/regexes. */
  columns: readonly SQLWrapper[];
  prefixes: readonly string[];
  regexes?: readonly string[];
};

/**
 * `true` when any column of the row carries a marker. NULL-safe: every
 * comparison reads `coalesce(col, '')`, so a NULL column is "absent", never
 * "unknown" — the difference between hiding fixtures and hiding real rows.
 */
export function qaMarkerCondition(spec: MarkerSpec): SQL {
  const clauses: SQL[] = [];
  for (const column of spec.columns) {
    const text = sql`coalesce(${column}, '')`;
    for (const prefix of spec.prefixes) clauses.push(sql`${text} ILIKE ${prefix}`);
    for (const regex of spec.regexes ?? []) clauses.push(sql`${text} ~ ${regex}`);
  }
  return sql`(${sql.join(clauses, sql.raw(' OR '))})`;
}

/* ---------------------------------------------------------------- *
 * Drizzle conditions — the board read.
 * ---------------------------------------------------------------- */

/** `shipments`: Bill / Booking / Mã lô + the QA notes + the free-text factory. */
export function qaFixtureShipmentMarkerCondition(): SQL {
  return sql`(${qaMarkerCondition({
    columns: [s.shipments.blNumber, s.shipments.bookingRef, s.shipments.shipmentCode],
    prefixes: QA_REFERENCE_PREFIXES,
  })}
  OR ${qaMarkerCondition({ columns: [s.shipments.operationalNotes], prefixes: QA_NOTES_PREFIXES })}
  OR ${qaMarkerCondition({ columns: [s.shipments.factoryName], prefixes: QA_SITE_PREFIXES })})`;
}

/** `trips`: the snapshot factory name a trip carries on its own row. */
export function qaFixtureTripMarkerCondition(): SQL {
  return qaMarkerCondition({
    columns: [s.trips.factorySiteName, s.trips.factorySiteAddress],
    prefixes: QA_SITE_PREFIXES,
    regexes: [QA_EPOCH_SUFFIX_REGEX],
  });
}

/** `trip_carrier_info`: the external plate + the external driver name. */
export function qaFixtureExternalCarrierMarkerCondition(): SQL {
  return sql`(${qaMarkerCondition({
    columns: [s.tripCarrierInfo.externalPlateNumber],
    prefixes: QA_PLATE_PREFIXES,
    regexes: [QA_EPOCH_SUFFIX_REGEX],
  })}
  OR ${qaMarkerCondition({
    columns: [s.tripCarrierInfo.externalDriverName],
    prefixes: QA_PERSON_PREFIXES,
    regexes: [QA_EPOCH_SUFFIX_REGEX],
  })})`;
}

/** `trucks`: own-fleet plate. */
export function qaFixtureTruckMarkerCondition(): SQL {
  return qaMarkerCondition({
    columns: [s.trucks.licensePlate],
    prefixes: QA_PLATE_PREFIXES,
    regexes: [QA_EPOCH_SUFFIX_REGEX],
  });
}

/** `drivers`: own-fleet driver name. */
export function qaFixtureDriverMarkerCondition(): SQL {
  return qaMarkerCondition({
    columns: [s.drivers.name],
    prefixes: QA_PERSON_PREFIXES,
    regexes: [QA_EPOCH_SUFFIX_REGEX],
  });
}

/** A customer/supplier display name (used for the board's own alias joins). */
export function qaFixturePartyMarkerCondition(name: SQLWrapper): SQL {
  return qaMarkerCondition({ columns: [name], prefixes: QA_PARTY_PREFIXES });
}

/**
 * An `operational_sites` row (the board's two factory aliases): name,
 * short name and code.
 */
export function qaFixtureSiteMarkerCondition(alias: {
  name: SQLWrapper; shortName: SQLWrapper; code: SQLWrapper;
}): SQL {
  return qaMarkerCondition({
    columns: [alias.name, alias.shortName, alias.code],
    prefixes: QA_SITE_PREFIXES,
    regexes: [QA_EPOCH_SUFFIX_REGEX],
  });
}

/* ---------------------------------------------------------------- *
 * Raw-SQL predicates — the purge registry.
 *
 * Same lists, plain text, so `seed/qa-fixture-registry.ts` cannot drift
 * from what the board hides. `qualify` prefixes bare column names for
 * the registry's sub-select aliases (`s.`, `t.`, …).
 * ---------------------------------------------------------------- */

function markerSqlText(
  columns: readonly string[],
  prefixes: readonly string[],
  regexes: readonly string[] = [],
  qualify = '',
): string {
  const parts: string[] = [];
  for (const column of columns) {
    const text = `coalesce(${qualify}${column}, '')`;
    for (const prefix of prefixes) parts.push(`${text} ILIKE '${prefix}'`);
    for (const regex of regexes) parts.push(`${text} ~ '${regex}'`);
  }
  return parts.join(' OR ');
}

export const QA_SHIPMENT_REFERENCE_COLUMNS = ['bl_number', 'booking_ref', 'shipment_code'] as const;
export const QA_SHIPMENT_NOTES_COLUMNS = ['operational_notes'] as const;
export const QA_SHIPMENT_FACTORY_COLUMNS = ['factory_name'] as const;
export const QA_TRIP_FACTORY_COLUMNS = ['factory_site_name', 'factory_site_address'] as const;
export const QA_EXTERNAL_CARRIER_COLUMNS = ['external_plate_number', 'external_driver_name'] as const;
export const QA_PARTY_COLUMNS = ['name'] as const;
export const QA_SITE_COLUMNS = ['name', 'short_name', 'code'] as const;

/** `shipments` rows carrying a fixture marker (bare columns; table-local). */
export function qaShipmentMarkerSql(qualify = ''): string {
  return [
    markerSqlText(QA_SHIPMENT_REFERENCE_COLUMNS, QA_REFERENCE_PREFIXES, [], qualify),
    markerSqlText(QA_SHIPMENT_NOTES_COLUMNS, QA_NOTES_PREFIXES, [], qualify),
    markerSqlText(QA_SHIPMENT_FACTORY_COLUMNS, QA_SITE_PREFIXES, [QA_EPOCH_SUFFIX_REGEX], qualify),
  ].join(' OR ');
}

/** `trips` rows carrying a fixture marker on their own columns. */
export function qaTripMarkerSql(qualify = ''): string {
  return markerSqlText(QA_TRIP_FACTORY_COLUMNS, QA_SITE_PREFIXES, [QA_EPOCH_SUFFIX_REGEX], qualify);
}

/** `trip_carrier_info` rows (external plate / driver). */
export function qaExternalCarrierMarkerSql(qualify = ''): string {
  return [
    markerSqlText(['external_plate_number'], QA_PLATE_PREFIXES, [QA_EPOCH_SUFFIX_REGEX], qualify),
    markerSqlText(['external_driver_name'], QA_PERSON_PREFIXES, [QA_EPOCH_SUFFIX_REGEX], qualify),
  ].join(' OR ');
}

export function qaPartyMarkerSql(qualify = ''): string {
  return markerSqlText(QA_PARTY_COLUMNS, QA_PARTY_PREFIXES, [], qualify);
}

export function qaTruckMarkerSql(qualify = ''): string {
  return markerSqlText(['license_plate'], QA_PLATE_PREFIXES, [QA_EPOCH_SUFFIX_REGEX], qualify);
}

export function qaDriverMarkerSql(qualify = ''): string {
  return markerSqlText(['name'], QA_PERSON_PREFIXES, [QA_EPOCH_SUFFIX_REGEX], qualify);
}

export function qaSiteMarkerSql(qualify = ''): string {
  return markerSqlText(QA_SITE_COLUMNS, QA_SITE_PREFIXES, [QA_EPOCH_SUFFIX_REGEX], qualify);
}

/** A free-text factory name carried on `shipments.factory_name`. */
export function qaFactoryNameMarkerSql(qualify = ''): string {
  return markerSqlText(QA_SHIPMENT_FACTORY_COLUMNS, QA_SITE_PREFIXES, [QA_EPOCH_SUFFIX_REGEX], qualify);
}