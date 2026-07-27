# Session 01 — Controller preflight

**Environment:** `https://vantai.tingting.vip/` staging  
**Started:** 2026-07-27T01:27Z  
**Build fingerprint:** `9627997bfd50ea0f5473ef500cf8e3026f3fb62f950b769cbc13539bfa0964f3`

## Health and identity

| Check | Result |
|---|---|
| Public frontend | PASS — HTTP 200 |
| API health | PASS — HTTP 200 with healthy status |
| Public assets | PASS — four versioned JS/CSS assets fingerprinted |
| ADMIN login/home | PASS — `/dashboard` |
| MANAGER login/home | PASS — `/dashboard` |
| ACCOUNTANT login/home | PASS — `/dashboard` |
| DRIVER login/home | PASS — `/my-trips` |
| FORWARDER login/home | PASS — `/my-forwarder-trips` |
| CUSTOMER login/home | PASS — `/portal/shipments` |
| CLERK provisioning | PASS — one ACTIVE CLERK account, opaque user ID `22` |
| CLERK login/home | PASS — `/clerk/shipments/new` |
| Provisioning audit | PASS — recent `ENTITY_CREATED` event observed |

No supplied or generated credential is stored in this report or any QA artifact.
The CLERK account remains active through Sessions 09 and 10.

## Read-only fixture availability

| Alias | Result |
|---|---|
| Office trips | Available |
| Office shipments | BLOCKED — no staging rows |
| AR/debt | Available |
| AP/payables | Available |
| Expenses | Available |
| DRIVER assigned trips | Available |
| FORWARDER assigned trips | Available |
| FORWARDER settlement | Available |
| CUSTOMER own shipments | BLOCKED — no staging rows |
| CUSTOMER debit notes | BLOCKED — no staging rows |

Missing fixtures will not be manufactured because business-data mutation is not
authorized. Detail/export/lifecycle cases that require them use execution
`BLOCKED` with reason `FIXTURE`.

## Manifests

- `execution-manifest.csv`: 483 rows
  - 338 module test cases
  - 23 Q cases
  - 122 expanded module-specific HT cells
- `route-manifest.csv`: 93 route patterns

## Responsive evidence

- `qa/2026-07-27_customer-handover_s01_public-login_desktop.png`
- `qa/2026-07-27_customer-handover_s01_public-login_tablet.png`
- `qa/2026-07-27_customer-handover_s01_public-login_mobile.png`
- `qa/2026-07-27_customer-handover_s01_public-login_mobile320.png`

The public login surface has no observed horizontal overflow or clipped primary
action at the captured widths.

Status: DONE_WITH_CONCERNS  
Summary: Staging health, seven role identities, CLERK provisioning, build fingerprint, and manifests are ready for fan-out.  
Counts: PASS 13 / FAIL 0 / BLOCKED 3 / NOT_RUN 0 / NOT_APPLICABLE 0  
Concerns/Blockers: No office shipment fixture; CUSTOMER has no own shipment or debit-note fixtures.
