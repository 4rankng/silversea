# Round-14 regression cases — ten reported tickets (batch 1 + batch 2)

Filed 2026-10-11 before implementation (AGENTS.md §6). Ticket IDs are the
kanban card IDs. Evidence of Phase-0 repro: `testplan/qa/evidence/2026-10-11_round14-phase0/`
+ driver log `qa/2026-10-11_round14_phase0-ui-driver.log`. Staging build under
test: 68609387 (= HEAD source; deployed CSS/JS chunks verified to carry the
round-13 fix markers).

## Case 2026-10-11-R14-01 — card 101026163000 (FB-006)

- Repro (staging, CUS thanhdc, /shipments/new): pick a factory in ô "Nhà máy".
  At a table container width ≤1037px (viewport ≤~1280px) the cell keeps the
  full combobox + nút Xoá beside the picked name (probe3 `at1024`
  editorChildOpacity=1). At container >1037px (viewport 1440) the cell
  collapses to name + magnifier (probe3 `at1440` editorChildOpacity=0).
- Root cause: `@container (max-width: 1037px)` block in
  `ClerkShipmentCreatePage.css` forces editors continuous for **every** cell
  with higher specificity than `ShipmentContainerCell.css`'s
  `:not(.csc-container-cell--picker)` exclusion.
- Expected: after a committed pick the cell shows only the factory name +
  magnifier at every width (tap/Enter re-opens the editor). Owner re-reported
  twice after the round-13 fix; the round-13 AC5 carve-out ("stacked records
  are forms") is reversed for picker cells only — text/number cells keep
  continuous editors in stacked mode.

## Case 2026-10-11-R14-02 — card 091026225630 (FB-008)

- Repro: a lô with many containers has no bulk date control — each container
  row's "ngày giao" is typed one by one (create form / dispatch detailed plan).
- Expected: a bulk date entry that applies one date to selected/all container
  rows. Pattern per Untitled UI PRO consultation (2026-10-11: `application/table`
  checkbox rows + `application/date-range-picker` + `application/modals/date-picker-modal`
  as reference; no bulk-actions primitive exists in the catalog — house
  implementation with house tokens).

## Case 2026-10-11-R14-03 — card 101026163010 (FB-009)

- Repro (staging, CUS, /shipments/new): the per-row copy-time button is absent
  ("mất hẳn") when the only other rows carry **partial date drafts** (typed but
  incomplete segments) — `emptyAppointmentKeys` excludes draft rows as
  destinations, so `canCopyAppointment` goes false everywhere (probe4:
  canonical states mount 1 button; nothing-to-copy state mounts 0).
- Expected: the affordance surfaces whenever the source row shows a schedule
  (committed or complete valid draft) and any other row lacks a complete
  schedule; copying onto a partial draft replaces the draft visibly (no dead
  button). Hover-reveal ruling 2026-09-18 unchanged.

## Case 2026-10-11-R14-04 — card 101026043000 (FB-038/072)

- Repro: assigning a vehicle whose time window duplicates an existing
  assignment on the same vehicle shows no warning (round-14 dispatch batch).
  Wave-5 guard `d03fffbb` warns only on the legacy plate-assign endpoint.
- Expected: the driven dispatch path warns (warn-once) before a duplicate-time
  assignment persists; same-lot rig rotation stays warn+confirm (ruling
  `6051d39a`). FB-072 = the sibling symptom named by QA (to pin from batch-2
  screenshots).

## Case 2026-10-11-R14-05 — card 101026043030 (FB-050)

- Repro (staging, /finance, "Top xe theo lợi nhuận"): the horizontal bar chart
  has no X-axis ticks/scale.
- Expected (owner ruling 2026-10-11, supersedes the twice-closed "HTML bars, no
  Cartesian axis" disproof): real X-axis ticks — axis baseline + tick marks +
  money labels (nice 1/2/5×10ⁿ steps), responsive label thinning. The
  zero-profit stray-tick suppression (af92c256) stays.

## Case 2026-10-11-R14-06 — card 101026163020 (FB-051)

- Repro (staging, /penalties "Kỷ luật"): saving/cancelling a penalty shows no
  success toast. `usePenaltyMutations.ts` has no feedback at all (only cache
  invalidation) — the round-13 fix `62239fed` covered `useCRUD` (penalty
  **reasons** config) only.
- Expected: commit-time success feedback on every penalties write path (create
  + cancel), same toast contract as `useCRUD`.

## Case 2026-10-11-R14-07 — card 101026043040 (FB-057)

- Repro (staging): topbar search "Tìm trang, cấu hình, thao tác…" is fixed at
  360px and stays 360px on focus (probe1 `fb057-search`).
- Expected (owner ruling 2026-10-11, supersedes the 360px cap ruling):
  360px at rest, expands smoothly on focus/typing (≈480–560px or fluid share),
  all role topbars.

## Case 2026-10-11-R14-08 — card 101026163030 (FB-069)

- Repro (round-14 report): "chi tiết hiện '500.00 kg'". On the current build
  (68609387) probe4/5 captured lot 464 (stored `weightKg="500.00"`) across
  overview row, detail header, detail pairs, /shipments-detail and edit inputs:
  **all formatted** ("500 kg", "5.000 kg"), zero decimal echoes. The reported
  text matches the PRE-fix symptom — stale QA session suspected.
- Expected: no surface echoes storage decimals ("500.00 kg"); weight/quantity
  render through `formatWeight`/`formatQuantity`/`stripDecimalTrailingZeros`
  everywhere. Red-first pins extended to the surfaces QA named; re-rung on
  staging with paired captures.

## Case 2026-10-11-R14-09 — card 101026163040 (FB-074)

- Repro (round-14 report): LCL overview vs detail mismatch (caveat: test lot
  incomplete). Probe5: lot 464 overview route "KCN QUẾ VÕ, BẮC NINH" ==
  detail "Tuyến đường=KCN QUẾ VÕ, BẮC NINH"; lot 463's overview row shows the
  lot label in the route slot — the paired-column capture (with headers) is
  the fix-phase rung.
- Expected: overview and detail resolve route names through the same authority
  (`resolveEffectiveRouteName`: container→lot→rawRouteName); documented
  fallback for incomplete lots.

## Case 2026-10-11-R14-10 — card FB-067 (ports backfill partial)

- Repro: ports backfill works in the master-plan "Chi tiết container" drawer
  (probe3 screenshot: NÂNG/HẠ selects live) and the CUS workboard ledger; QA
  still reports "partial".
- Expected: port backfill complete across the dispatcher's surfaces; the
  E2E-KEP-001 staging rung (fill ports → Kẹp merge validation) executes and is
  captured; any surface still read-only is named or closed in the card.
