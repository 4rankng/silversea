-- BE contract probes for 36d0183d (driver app enhancements spec, TC-DA-002..007)
-- Run: 2026-09-11 ~12:05 +07 | env: LOCAL dev DB (silversea-db @ localhost:5441) + local backend :3001
-- Runner: BE lane (team run du55md). Read-only. HEAD aa4025c5.
--
-- VERDICT: P1–P4 PASS (with corrected column paths — see CORRECTIONS), P5 shape
-- captured at contract level; live HTTP capture BLOCKED by a local-env auth bug
-- (see ENV BLOCKER). Spec corrections required before FE gate.

-- ============================================================
-- CORRECTIONS to the spec's probe table (testplan/qa/2026-09-10_driver-app-enhancements.md:161-173)
-- ============================================================
-- C1. `kho_phone` DOES NOT EXIST anywhere in the schema. Warehouse phone lives at
--     operational_sites.contact_phone, joined via shipment_containers.operational_site_id.
--     Driver API surfaces it as `siteContactPhone` (driver.service.ts:588).
-- C2. `trips.tractor_plate / trailer_plate` DO NOT EXIST. Trips normalize to
--     truck_id/trailer_id; plates live on trucks.license_plate /
--     trucks.trailer_plate_number. (TC-DA-004 answer: BE does NOT keep plate
--     fields on trips — FK-normalized since the schema refactor.)
-- C3. Invoice data (TC-DA-005) is NOT customers.tax_code/company_name/address.
--     The driver-portal invoice contract = operational_sites lift/drop/cleaning
--     invoice columns (liftFeeInvoiceName/Address/TaxCode, dropFeeInvoice*,
--     cleaningInvoice*) surfaced by driver.service.ts:596-604.
--     customers.name/tax_code/address DO exist and are populated (P4 below) —
--     they are customer-identity fields, not the driver-portal invoice source.
-- C4. `GET /api/driver/me/trips/:id` DOES NOT EXIST. Driver detail endpoint is
--     GET /api/driver/me/fulfillments/:fulfillmentId (driver.ts:329).
--     POD upload family (TC-DA-007): POST /me/fulfillments/:fulfillmentId/pod,
--     POST .../pod/:submissionId/files (multipart 'file'),
--     POST .../pod/:submissionId/submit (driver.ts:402/427/463).
-- C5. Driver auth: login uses `identifier` field (not username): POST /api/auth/login
--     {identifier, password}. Tokens carry random jti; middleware checks a Redis
--     blacklist (see ENV BLOCKER).

-- ============================================================
-- P1 (TC-DA-002): factory fields on shipments — PASS
-- ============================================================
SELECT id, shipment_code, factory_name, factory_address IS NOT NULL AS has_factory_address
FROM shipments WHERE factory_name IS NOT NULL ORDER BY id DESC LIMIT 3;
--  id | shipment_code   | factory_name | has_factory_address
--  10 | SHP-2609-00010  | NEWEB-1      | t
-- API contract: driver.service.ts:575 factoryName ← shipments.factoryName,
-- fallback containerFactory (operational_sites via containers.operational_site_id)
-- + siteSnapshot projection. Mixed rows available for hide/show parity.

-- ============================================================
-- P2 (TC-DA-003): warehouse phone, NULL + populated mix — PASS (corrected path per C1)
-- ============================================================
-- Spec query (FAILS): SELECT kho_phone FROM shipment_containers ... → column does not exist.
-- Corrected:
SELECT c.id, c.container_number, os.name AS site_name, os.contact_phone
FROM shipment_containers c
LEFT JOIN operational_sites os ON os.id = c.operational_site_id
WHERE c.container_number IS NOT NULL
ORDER BY (os.contact_phone IS NULL), c.id DESC LIMIT 6;
-- Sample rows all had NULL contact_phone on recent containers (site unlinked):
--   7173 | MSKU1234565 | (null) | (null)  ... etc.
-- Coverage: 11/324 containers carry operational_site_id → hide-path dominates;
-- populate via operational_sites.contact_phone for show-path fixtures.
-- API contract: siteContactPhone ← containerFactory.contactPhone (driver.service.ts:588).

-- ============================================================
-- P3 (TC-DA-004): tractor/trailer plates — PASS (corrected path per C2)
-- ============================================================
-- Spec query (FAILS): SELECT tractor_plate, trailer_plate FROM trips → columns do not exist.
-- Corrected:
SELECT t.id, tr.license_plate AS tractor_plate, tr.trailer_plate_number AS trailer_plate
FROM trips t LEFT JOIN trucks tr ON tr.id = t.truck_id ORDER BY t.id DESC LIMIT 4;
--   id  | tractor_plate | trailer_plate
--  5244 | (null)        | (null)
--  5224 | 15H-104.03    | 15RM-107.28
--  5187 | (null)        | (null)
--  4408 | (null)        | (null)
-- Mixed populated/NULL rows exist → both render paths testable. Trip 5224 has both plates.

-- ============================================================
-- P4 (TC-DA-005): customer identity fields — PASS (corrected name per C3)
-- ============================================================
-- Spec query (FAILS): SELECT company_name ... → column does not exist (it is `name`).
-- Corrected:
SELECT id, name, tax_code, address FROM customers WHERE tax_code IS NOT NULL ORDER BY id DESC LIMIT 3;
--  id  | name                                            | tax_code       | address
--  6642 | CÔNG TY CỔ PHẦN GIAO NHẬN VẬN TẢI DH-CHI NHÁNH | 0102897678-002 | (null)
--  5674 | CÔNG TY CỔ PHẦN VÂN LAN                        | 0200659738     | (null)
--  4631 | CÔNG TY TNHH THƯƠNG MẠI VÀ DỊCH VỤ VẬN TẢI PCAV | 0202233102     | (null)
-- NOTE: top rows have NULL address — address is sparse; invoice display must
-- blank-safe it. Driver-portal invoice source is operational_sites.* (C3).

-- ============================================================
-- P5 (TC-DA-007): driver trip detail response shape — CONTRACT CAPTURED, live capture BLOCKED
-- ============================================================
-- Live HTTP capture attempted: login lvtuyen (16 trips, latest trip 5224) →
-- GET /api/driver/me/trips/5224. Login SUCCEEDS (token 312 chars, jti random),
-- but every authenticated GET returns 401 {"error":"Token đã bị thu hồi"}.
-- Root cause (ENV BLOCKER, affects ALL local authenticated testing):
--   auth middleware checks Redis blacklist; the running backend's EXISTS never
--   reaches the healthy silversea-redis (localhost:6391) — verified via REDIS
--   MONITOR during the request (only unrelated pings). isTokenBlacklisted()
--   fails CLOSED on Redis errors (redis.ts:121-126) → every jti-carrying token
--   is treated as revoked. payroll-redis (another project) squats on 6379;
--   suspect the backend process env points REDIS_URL at the wrong target.
--   Fix: restart local backend with REDIS_URL=redis://localhost:6391.
--
-- Contract shape (code-verified at HEAD aa4025c5, driver.service.ts:551+):
-- GET /me/fulfillments/:fulfillmentId returns:
--   shipmentId, shipmentCode, bookingRef, cargoMode, tradeDirection,
--   fulfillmentType, factoryName (+ containerFactoryName/ShortName fallbacks),
--   shippingLineName, expectedDeliveryDate, customsCutoffAt, closingAt,
--   plannedReturnAt, pickupLocation, deliveryLocation, contactName,
--   contactPhone, driverNotes, siteSnapshot (projected), siteContactName,
--   siteContactPhone, containerPickupPortName, containerDropoffPortName,
--   lift/drop/cleaning InvoiceName/InvoiceAddress/TaxCode (x3 families),
--   + evidenceStatus, milestones, podSubmissions, containerSealPhotos
--   (id, type CONTAINER|SEAL, storageKey, uploadedAt).

-- ============================================================
-- ENV BLOCKER (team-wide) — local authenticated API is down
-- ============================================================
-- Symptom: fresh login works, ANY authenticated endpoint 401s "Token đã bị thu hồi".
-- Mechanism: auth.ts:93-95 → redis.ts:116-127 fail-closed blacklist check.
-- Evidence: Redis@6391 MONITOR shows NO EXISTS during request; blacklist:* keys = 0;
--           silversea-redis healthy; payroll-redis also listens on 6379.
-- Impact: blocks P5 live capture + any local auth-driven verification (Amendment 4
--         says local-only during SDLC — this is the whole team's verify env).
-- Owner: whoever started the :3001 backend (likely make dev / Terminal tab pty-69).
