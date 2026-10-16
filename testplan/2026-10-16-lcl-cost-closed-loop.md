# Testplan — LCL cost closed loop (staging, 2026-10-16)

Contract: `docs/qa-guides/2026-10-15_dev-spec-luong-hang-le.docx` +
`docs/qa-guides/2026-10-16_huong-dan-kiem-thu-hang-le-chi-phi.docx`.
Staging `vantai.tingting.vip`, build `2176e29e` verified via `/api/health` before every claim.
Accounts: `testplan/testaccounts.txt` (tiepvv/dungnv/hoapt/admin/hoangnh, password per file).
All writes carried `Idempotency-Key`. Fixtures `QAC2R3-CL01..04` (lots 570–573) cleaned up:
trips 185/186/187 deleted; lots 571–573 absent on direct GET at cleanup time (404).

## Track 1 — functional (API evidence under `qa/2026-10-16_lcl-loop_*.log`)

| Case | Scenario | Result | Evidence |
|---|---|---|---|
| TC-A1 | CUS tạo lô hàng lẻ (cargoMode LCL, bookingRef, PALLET/5/1900/4) | VERIFIED (API + UI fields at 375px) | lot 570/571 201; `qa/1016-ui/1016_create-mobile-375-lcl-cargo-section.png` |
| TC-A2 | Kế hoạch Tổng quát display (no "Chưa có cont", `[n] [bao bì] · kg · CBM`) | VERIFIED (UI DRIVEN) | `qa/1016-ui/1016_masterplan-mobile-390.png` — "Hàng 5 PALLET · 1.900 kg · 4 CBM", "Nâng —/Hạ —", "Lẻ: N lô" bucket |
| TC-A3 | Multi-select totals bar | VERIFIED (UI, pre-existing pin) | existing component tests; selection bar markup unchanged this build |
| TC-A4 | Gán xe nhóm: Loại xe tính cước + BKS thực + BKS ảo | VERIFIED (API; FB-090 negative too) | `qa/2026-10-16_lcl-loop_api-cost-group.log` |
| TC-A5 | Ghép cước thu khách popup + same-customer merge | VERIFIED (API + display refs) | `qa/2026-10-16_lcl-loop_api-rev-group.log`; shipment 571 carried `revGroupPrincipalRef=QAC2R3-CL01` |
| TC-A6 | Nhảy tiền 100%/0đ both dimensions | VERIFIED | COST: freight 1.500.000/0 (trips 184/185); REV: revenue 2.345.098/0 (AUTO-priced from LOGCOM×route12×5T lane) |
| TC-A7 | Cross-customer merge blocked | VERIFIED | 400 "Chỉ ghép cước thu được các lô của cùng một khách hàng — lô QAC2R3-CL03, QAC2R3-CL04 khác khách hàng" |
| TC-A8 | Debit board facts + Debit Note BKS ảo law | VERIFIED (API/code-read) | board row 571: `lcl.label="Lẻ · Thu: 5T · Trả: 5T"`, BKS pair + `ghépCùngRef` fields; export law `billing-document-draft.service.ts` (FB-094: billingTruckNo wins) |
| TC-A9 | Hủy ghép / xóa Lô 1 → tiền chuyển Lô 2 | VERIFIED (both dimensions + delete-path) | unmerge REV transferred 2.345.098 → 571; unmerge COST transferred 1.500.000 → 571; delete of dispatched principal refused 409; no-trip principal delete dissolves group cleanly |
| TC-A10 | Bảng giá theo Loại xe | FIXED (F-1) + retested | see below |

### F-1 — pricing-table vehicle-class selector rejected as second axis (backend) — FIXED + retested
- Repro (staging): `POST /api/pricing-tables` class-only → 400 "Chỉ được chọn một trục giá…" (payload shapes a/b/c/f/g in `qa/2026-10-16_lcl-loop_pricing-axis-probes.log`; bogus-customer probe (d) isolated the throw to the governed apply re-running `beforeCreate` on the denormalized payload).
- Root cause: `validatePricingSelector` rejected the canonical denormalized pair (classId + rateKey=class code) that the write path itself stamps; governed apply double-run made every class-linked create fail. Update merges on-disk class rows fail the same guard.
- Fix: guard accepts the pair (container-vs-class exclusivity kept; rateKey mismatch still rejected by `denormalizeVehicleClassSelector`). Commit with 6-case unit test; backend unit tier 281/281.
- Retest: local backend (build dev, real governed path): class-only POST → 201 (rateKey denormalized), PUT price → 200, DELETE cleanup 200.

### F-2 — LCL merge money channel ≠ debit boards' read channel (backend/money — DOCUMENTED, needs owner ruling)
- FB-093 writes the 100%/0đ jump to `trip_financial_state.revenue` (staging-proven: 571 = 2.345.098, member = 0 with override markers).
- Both money boards read a different channel: CUS "Chi phí - Quyết toán" `freightAuto` ← `freight_rate_snapshots`; Kế toán "Kế hoạch điều động tổng hợp" `thu.cuocThu` ← trip legs `freight_amount`. Neither reads `trip_financial_state.revenue`.
- Net: with real priced trips, after a merge the boards keep showing each lot's own AUTO freight — the spec's §3.2/§4 display law (Lô 1 = 100%, members 0₫ + "Ghép cước cùng Bill") is not reflected on the money columns themselves.
- Not fixed here: choosing between (a) merge writes snapshot overrides, (b) boards read the override channel, or (c) snapshot recapture on merge is a money-logic decision (affects FCL semantics too). Routed for owner/Hermes.

### F-4 — trip GET omits revenueOverrideReason (backend, minor) — DOCUMENTED
- `getTripById`/`getTrips` select `revenueOriginal/OverriddenBy/At` but not `revenueOverrideReason`; the zero-reason stamp ("Ghép cước cùng Bill X" / promotion reasons) is DB+audit-only, no API surface. No consumer exists in FE today. Candidate one-line select addition when an operator surface for the zero reason is wanted.

### Already-ticketed, reproduced for the record (no action here)
- TC-B2: OPS GET /api/shipments → 403 (page "Bạn không có quyền truy cập trang này"); "Khai chi phí" per-vehicle scope rule intact per FB-033 ruling. Ticket 141026230710 (P1).
- TC-B6: tạm ứng phê duyệt / hoàn ứng tick + số âm — ticket 141026230770 (docx-known).
- TC-B1/B4/B5: docx marked ĐẠT (UI) on this same build — not re-driven here.

## Track 2 — UI/UX (screenshots `qa/1016-ui/`, driver log `qa/2026-10-16_lcl-loop_ui-driver.log`)

| Spec point | Result |
|---|---|
| Sections/bands at 375px (Thông tin container / Lộ trình / Thời gian) | PASS — DOM + screenshot (`1016_create-mobile-375-container-bands.png`); desktop hides bands (`bandsDisplay:["none","none","none"]`) |
| 2-col pairs at 375px | PASS — row grid `156.5px 156.5px` |
| Unified outlined controls + chevron on pickers | PASS — 11 chevrons; screenshot |
| Cảng nâng→hạ chevron seam marker | PASS — visually in bands shot |
| Rose required markers | FIXED (F-3): Ngày giao hàng rendered `* *` (UUI brand star + ds rose star). One rose mark after fix (screenshot + DOM probe in commit evidence) |
| Desktop container table intact | PASS — headers STT/Số container/Loại container/Nhà máy/Tuyến đường/Cảng nâng; 1 row |
| Kế hoạch Tổng quát CSS regression | PASS — 1440 + 390 clean, no overflow, LCL rows render spec-format |
| Chi tiết lô hàng CSS regression | PASS — 1440 + 390, "Hàng lẻ (LCL)" chip, cargo facts, Containers (0) |

### F-3 — doubled required mark on LCL Ngày giao hàng (frontend) — FIXED + retested
- Repro: staging 375px drive; label HTML carried two marks (`text-brand-tertiary` brand star from `isRequired={required || requiredMark}` + `ds-field__required`).
- Fix: `BufferedUuiDateInput` renders the Label brand star only when `requiredMark` is absent (single rose cue). Commit with before/after DOM probe + screenshot.
- Retest: local frontend 375px — exactly one `ds-field__required` span; scoped vitest 43 files/337 tests + `tsc -b` 0.

## Not covered
- UI-driven (rung 3) drive of the FB-092 "Gán xe nhóm" and FB-093 "Ghép cước thu khách" popups on staging (the docx's TC-A4/A6 automation blocker). The underlying money laws are API-verified (rung 2, exact endpoints and amounts); the popups' open/submit paths are component-test-covered. A visual click-through of both dialogs remains open for the next UI pass.
- B-track UI (B1/B4/B5/B6): same build as the docx's 16/10 UI pass; not re-driven.
- Debit Note FILE (xlsx/pdf) content: FB-094 plate law verified in code (`billing-document-draft.service.ts`), file bytes not generated.
- Local dev DB is a mirror: the local pricing retest created a QA row (deleted) on the mirrored DB, not staging.
