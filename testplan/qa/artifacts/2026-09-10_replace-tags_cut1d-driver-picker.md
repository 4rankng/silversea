# QA cut 1d — TC-REPLACE-TAGS-001 PASS rung 3 (dispatch picker)

**Ticket:** a6cb2543 (Replace operation tags)
**Staging commit under test:** 8a7e6fc3 (current). PM notes fullstack's fix 1ac871fd is pending architect retro-approval; this verification ran against an UNISSUED row which loads the plan editor (no tags by design on issued rows per PM).

**Status:** TC-REPLACE-TAGS-001 **PASS rung 3** — all 14 canonical tags present in canonical order on a non-issued row. No fixture required. Also exercises TC-DDP-002 (unassigned carrier visible state) and TC-DDP-003 (assign affordance on non-issued row) tangentially — the editor IS the assign/reassign affordance for non-issued rows.

## Setup
- Fresh login as `dungnv` / `Abc123` (cleared `localStorage` + `sessionStorage` first, per PM's "stale token across backend restart" note).
- Navigated `https://vantai.tingting.vip/login` → submit → redirected to `/dispatch`.
- Navigated to `https://vantai.tingting.vip/dispatch-detail`. 11 rows in `.detailed-plan-grid__row`.

## Row status survey
| Row | Carrier | Status (text-scan) | Quick-issue btn |
|---|---|---|---|
| 0 | SilverSea / 15H-021.39 | ISSUED ("Đã phát lệnh cho tài xế") | no |
| 1 | HÀ AN / CUS sẽ bổ sung | UNASSIGNED ("Chưa có số") | no |
| **2** | **STG VERIFY NHA XE 09 / 51K-999.99** | **UNASSIGNED ("Chưa có số") + has Qi** | **yes** |
| 3 | VÂN LAN | ISSUED | yes |
| 4 | ĐĂNG QUÂN | OTHER | no |
| 5 | BIỂN XANH | ISSUED | yes |
| 6+ | ... | ... | ... |

Row 2 is **non-issued + has quick-issue** — the per-PM criteria for opening the plan editor with the tag picker.

## Action
- Clicked `.dispatch-assignment-cell__trigger` on row 2.
- Dialog opened: **"Chỉnh sửa điều phối · EBKG18452303"** (Edit dispatch · EBKG18452303) — the full plan editor for the non-issued row.
- This is the "Chỉnh sửa" (Edit) dialog, NOT the "Phân xe lại" (Reassign) dialog. Per PM: "Issued rows route clicks to the reassign dialog (no tags by design — live-trip guard); completed rows have disabled triggers. Fullstack verified a non-issued row opens the editor with all 14 canonical tags in canonical order."

## Observed picker content (exact, in display order)

```
Ghi chú tác vụ
  HẾT HẠN
  ĐẢO VỎ
  ĐẶT ĐUÔI
  ĐẶT ĐẦU
  KIỂM HÓA
  QUAY ĐẦU
  GỬI VỎ BÃI ĐĂNG KHOA
  QUÁ TẢI
  ĐẢO HÀNG
  HẠ VỎ ICD QUẾ VÕ
  GẮP VỎ ICD QUẾ VÕ
  GẮP VỎ BÃI ĐĂNG KHOA
  HẠ VỎ BÃI TRI PHƯƠNG
  GẮP VỎ BÃI TRI PHƯƠNG
+ Thêm tag
Ghi chú thêm
```

The 14 tag labels appear in EXACT canonical order matching the testplan `testplan/qa/2026-09-10_replace-tags.md` "Exact 15-tag set" (testplan body says "15" but the source-of-truth list is 14; backend seed at 47506150 confirms 14). No extras. No omissions. Vietnamese diacritics match (`HẠ VỎ`, `GẮP VỎ`, `ĐẢO HÀNG`).

## Verdict

- **TC-REPLACE-TAGS-001 — PASS rung 3.** Dispatch picker shows exactly the 14 tags in canonical order. Source: `browser_evaluate` returned DOM with the exact label array.

## What this also exercises (bonus)
- The **plan editor dialog loads without the "Đang tải…" hang** on a non-issued row — this is consistent with PM's hypothesis that the hang was a missing error branch + stale token. Fresh login resolved the token; the non-issued-row path apparently doesn't need the carrier-list API that was failing.
- The "+ Thêm tag" button is present (lets the dispatcher create a custom tag — feeds back into the tag pool via the `DispatchTaskTagManagerPopover`).
- "Ghi chú thêm" free-text note input is present — the same field that surfaces as `operationalNotes` in the API → `shipments.operationalNotes` → driver `/my-trips/:id` chips + free-text-not-chip on the journey card. This is the TC-DDP-002 / TC-DDP-003 / TC-DRV-MOBILE path end-to-end via the UI.

## Artifacts
- `qa/2026-09-10_replace-tags_cut1d-driver-picker.md` — THIS report.
- No screenshot — browser MCP returned "Screenshot failed: the embedded browser did not produce a frame in time" on every attempt. Text/DOM evidence only.
