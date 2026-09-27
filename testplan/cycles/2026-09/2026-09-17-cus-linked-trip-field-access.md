# CUS linked-trip route and port edit affordance

## Root cause and scope

On `/shipments-detail`, CUS can click the route/ports cell for container
`CSQU3054383` in `QA17-NOAPP-1789626140405`, but the fresh detail check rejects
the editor before any mutation. Browser reproduction exists at both 390 and
1440 px in `qa/2026-09-17-sisprod/roles/CUS-inline-final-error-route-*`.

`containerFieldAccess` overrides route and port fields to `DIRECT` for CUS
even when an active trip exists. The same response's operational permissions
are false, and the authoritative writer rejects changed route/ports on linked
trips with 409. The fix aligns only that read projection with the existing
write gate. Container-number identity correction remains direct before an
accounting lock. No write permission, serializer, approval flow, or schema is
changed.

## Checks, defined before implementation

| ID | Scenario | Required evidence |
| --- | --- | --- |
| SISPROD-CUS-ACCESS-001 | CUS container without a linked trip, with past or future appointment | Route/lift/drop remain `DIRECT`; existing permission booleans remain true. |
| SISPROD-CUS-ACCESS-002 | Same container with a live linked trip | Flat-list and detail route/lift/drop are `READ_ONLY`; matching permission booleans are false, and their reason explains the trip restriction. |
| SISPROD-CUS-ACCESS-003 | CUS/dispatcher container-number correction on linked nonterminal shipment | Container-number field remains `DIRECT`; existing real save regression continues to pass. |
| SISPROD-CUS-ACCESS-004 | Direct CUS writer call tries changed route, lift, or drop on linked trip | Existing 409 linked-trip denial remains; container values and shipment version stay unchanged. |
| SISPROD-CUS-ACCESS-005 | Accounting-locked CUS container | Number and operational fields remain `READ_ONLY`. |
| SISPROD-CUS-ACCESS-006 | Frontend receives locked operational field access | Container identity edit remains available, while route/port edit is absent; no detail fetch or write is triggered for a read-only cell. Existing unlinked port editor/save behavior remains covered. |
| SISPROD-CUS-ACCESS-007 | Exact original browser fixture after API restart | At 390/1440, linked-trip route/ports render read-only and retain displayed values; permitted container identity remains reachable. Verify a local unlinked row still opens ports editor. Record screenshots, actual controls, and request evidence. |

## Execution and limits

- Run focused backend integration cases only against the root-coordinated local
  test database, after the full suite releases it; retain exact commands/logs.
- Run the targeted frontend regression after the full frontend suite completes.
- Re-run backend type/lint checks appropriate to the final builder/test diff.
- Root/role browser agent owns the exact-fixture browser recheck after restarting
  the local API. Source review and mocked tests do not substitute for that step.
- Refresh the configured `.ua` graph through the official plugin pipeline after
  the source freeze and latest fast-forward; no generated-file hand edits.
