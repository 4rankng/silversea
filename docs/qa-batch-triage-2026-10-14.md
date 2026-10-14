# QA batch-report triage — 2026-10-14

14 batch-report tickets were filed by the other QA party on the TODO board. The
board is managed by **Muse** and is not part of this repository, and the
Silversea backend has **no ticket/kanban/board model or API** (verified against
`backend/src/db/schema/*` and `backend/src`/`shared/src` on 2026-10-14: the only
"task"/"board" hits are dispatch tasks and the driver journey board — domain
concepts, not a ticket system). The ticket names also appear nowhere in this
repo (`testplan/`, `docs/`, `plans/`, `qa/`). **Ticket content must come from
Muse before triage can proceed.**

## The 14 tickets

Confirmed names (from the filing notice):

| # | Ticket | Status |
|---|--------|--------|
| 1 | `r17-verify-batches` | Need content from Muse |
| 2 | `r17-tong-ket` | Need content from Muse |
| 3 | `r20-batch-1` | Need content from Muse |
| 4 | `r20-batch-2` | Need content from Muse |
| 5 | `r20-batch-3` | Need content from Muse |
| 6 | `r20-tong-ket` | Need content from Muse |
| 7–14 | verify re-run tickets (8) | Need content from Muse — exact slugs not visible from this repo; get the full list from the board |

The remaining 8 are verify re-runs of the batch reports; this document does not
guess their slugs. Once Muse supplies ticket bodies, extend the table above with
per-ticket summaries and fill the "Likely related" column below.

## Dedupe map — known FB tickets

What this repo already records for each FB ticket the batches may overlap with.
Round numbering: `r17-*` tickets likely duplicate round-17 helpdesk items
(FB-083…FB-086); `r20-*` tickets likely duplicate round-20 items.

| FB ticket | Topic (from repo records) | Local evidence | Likely related | Notes for dedupe |
|---|---|---|---|---|
| FB-083 | No local record | none found 2026-10-14 | r17 batch | Need description from Muse before any dedupe call |
| FB-084 | No local record | none found 2026-10-14 | r17 batch | Need description from Muse |
| FB-085 | No local record | none found 2026-10-14 | r17 batch | Need description from Muse |
| FB-086 | Add container to an existing lot on the shipment-detail lot board (`/shipments-detail`) | `testplan/cycles/2026-10/2026-10-14-fb086-workboard-add-container.md`; `testplan/cycles/2026-10/2026-10-14-r19-fb086-edit-add-container.md`; landed in round 19 (`c7dcc286` add-container fix) | r17 batch | Helpdesk FB-086, round 17. If an r17 batch re-reports this, check whether QA tested a build before `c7dcc286` (stale-build pattern is known — see FB-069 ruling) |
| FB-009 | Copy-appointment button vanishes when sibling rows hold partial date drafts (`/shipments/new`, CUS) | `testplan/2026-10-11-round14-kanban-cases.md` case R14-03 (card 101026163010) | r17/r20 batch | Hover-reveal ruling 2026-09-18 unchanged |
| FB-043 | No local record | none found 2026-10-14 | unknown | Note: `FB-033` (OPS-only visibility) exists in project memory but is a different ticket |
| FB-048 | Debt detail: invalid amount must paint red-invalid boundary and not stick to an already-corrected draft | `frontend/src/pages/DebtDetailPage.tsx:128`; `frontend/src/pages/DebtDetailPage.payment.test.tsx:325` (card 111026105600) | r20 batch | |
| FB-057 | Topbar search fixed at 360px; owner ruling 2026-10-11: expand on focus (≈480–560px or fluid), all role topbars | `testplan/2026-10-11-round14-kanban-cases.md` case R14-07 (card 101026043040) | r17/r20 batch | If re-reported as "still 360px", check whether QA tested a pre-ruling build |
| FB-061 | Invoice tracking (card 376); seed fixture cleanup, data-only | `testplan/fixtures/2026-10-08-fb061-invoice-tracking-card376-cleanup.md` | r17/r20 batch | Cleanup only; no code change |
| FB-066 | Trip-create quick-add state (verify-fail state capture, read-only) | `testplan/qa/scripts/fb066-trip-create-quickadd-state-rung.mjs` (card 121026141040); project memory: fb066 dispatch quick-add verified intact — do not rip out on a stale QA verdict | r20 batch | Round-16 memory records this as verified-intact; a fresh r20 re-report needs new reproduction evidence, not a re-open |

## Standing caveats for triage

- **Stale-build pattern:** prior rounds produced re-reports against builds that
  predate the fix (FB-069 "500.00 kg" was retracted for this reason; round-16
  memory marks FB-066 verified-intact). Before accepting any batch duplicate of
  FB-086/057/066, confirm the build/commit the QA party tested against.
- **Per AGENTS.md §1**, do not reopen owner rulings (e.g. the FB-057 width
  ruling, FB-066 verified-intact verdict) without new reproduction evidence.
- This file is a triage placeholder. Replace the "Need content from Muse"
  statuses with real summaries once the board content is available; do not
  infer ticket content from names.
