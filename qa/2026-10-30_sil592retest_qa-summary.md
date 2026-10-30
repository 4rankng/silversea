# SIL-592 retest (30/10) — departure-gate fix · QA evidence

Branch fix-sil-592-cus-ext-close · d293406d (BE wire) + 66c41f77 (FE gate+toast)

## Repro gốc (QA board comment 2953)
`POST /trips/519/complete-external` (CUS, role cus) → **HTTP 400**
`Ngày hoàn thành không thể trước ngày khởi hành.` — trip 519 departure
2026-10-31, hôm nay 30/10. Nút vẫn hiện vì gate FE không biết departure →
dead button. Toast lỗi tự tắt sau 4.5s → QA báo «không có thông báo lỗi».

## Gates (exit codes trong từng file .txt/.log)
| Gate | File | Kết quả |
|---|---|---|
| shared suite | `qa/2026-10-30_sil592retest_shared-test.txt` | 19/19 pass |
| BE tsc | `qa/2026-10-30_sil592retest_be-tsc.txt` | 0 error |
| BE unit+integration | `qa/2026-10-30_sil592retest_be-test.txt` | 589/589 + 338/338 |
| FE tsc -b | `qa/2026-10-30_sil592retest_fe-tsc.txt` | 0 error |
| FE scoped vitest (6 file) | `qa/2026-10-30_sil592retest_fe-scoped-vitest.txt` | 83/83 |
| root lint | (stdout) | 0 error (8 warning cũ) |
| UI drive | `qa/2026-10-30_sil592retest_ui-driver.log` | 7/7 PASS |

## UI drive rung-3 (local dev · role CUS · lot 167 R39B1-LCL01 · trip 519 EXTERNAL 15C-581.58)
- T01 departure 31/10 (mai): row KHÔNG có nút «Hoàn thành» (dead-end gone) — `ui-t01-no-button-future-departure.png`
- T02 departure sửa về hôm nay (30/10): nút hiện, aria-label đúng — `ui-t02-button-same-day-departure.png`
- T03 dialog «Hoàn thành chuyến với xe ngoài R39B1-LCL01? …» — `ui-t03-dialog.png`
- T04 toast «Đã hoàn thành chuyến xe ngoài.» + chip «Hoàn thành» — `ui-t04-completed.png`
- T05 API row tripStatus=COMPLETED · T06 DB trips.status=COMPLETED (+completed_at) &
  shipments.status=COMPLETED · T07 workspace bucket=LOCKED («Đã khóa» — đúng expectation QA)

## Not covered
- Toast lỗi persist (kind=error) không drive được ở UI tự nhiên sau fix (nút đã
  ẩn đúng khi blocked) — pin bằng unit `Toast.test.tsx` (5/5).
- Surface Điều vận (DispatchRowActionsMenu / DispatchPlanEditorCell — file cấm
  theo scope) giữ nguyên hành vi; banner lỗi inline ĐV đã hiện message server.
- Các viewport 390/768 không drive lại (surface không đổi layout; button
  geometry law đã pin từ 29/10, T01/T02 drive ở 1280).
