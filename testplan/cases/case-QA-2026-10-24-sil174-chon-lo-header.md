# Case QA-2026-10-24-SIL174 — /dispatch-detail header cột CHỌN đọc "CHỌN LÔ CHỌN" (cosmetic)

Ticket SIL-174 (board plan.tingting.vip, id 204). Surface: /dispatch-detail →
[Gộp hàng] hiện cột CHỌN đầu bảng (`DetailedPlanGrid`).

## Root cause

Header detailed-plan đặt sr-only TRƯỚC nhãn visible:
`<span class="sr-only">Chọn lô</span> Chọn` → text-content của ô =
"Chọn lô Chọn" ("CHỌN LÔ CHỌN" khi uppercase). /dispatch (`MasterPlanGrid`)
đặt ngược: nhãn "Chọn" + sr-only " lô" → đọc "CHỌN LÔ". Cùng một cột, hai
structure khác nhau → text không đồng bộ.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| SIL174-R1 | /dispatch-detail bật [Gộp hàng] | Header cột đầu text-content = "Chọn lô" (đồng bộ /dispatch); visible "CHỌN"; screen-reader đọc "Chọn lô" |
| SIL174-R2 | /dispatch | Không đổi — header "Chọn" + sr-only " lô" |
| SIL174-R3 | Vitest | `DetailedPlanGrid.lcl-grouping.test.tsx` pin text-content header "Chọn lô" |

## Rule (nguồn)
Spec 23/10 (261023110000 §2) — cột CHỌN on-demand; house pattern master-plan.

## Verify
- `qa/2026-10-24_sil174_chon-lo/` — screenshot UI trước/sau (rung 3).
