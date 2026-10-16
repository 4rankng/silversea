# Tờ khai per-cont — auto-copy số đầu tiên + thẩm tín regression "UI biến mất" (tickets 141026201700 / FB-085 / 131026200630)

Ngày: 2026-10-14 · ưu tiên P1 · GitHub issue #7 · branch `feat/per-container-tokhai`

## Vấn đề đã báo

1. Staging reportedly "missing" toàn bộ UI tờ khai per-container + nút copy
   (customer feedback 141026201700 / FB-085 / 131026200630).
2. Ticket yêu cầu: nhập tờ khai container ĐẦU TIÊN → tự copy sang các container
   còn lại (kèm nút copy tường minh). Code hiện tại chỉ có nút copy
   (2ba09d85, "predictable action over magic") — không có auto-copy.

## Thẩm tín claim "UI biến mất" (rung 1 → chạy UI chạy 3)

- `c4c9d45a` (2026-10-13): cột `shipment_containers.declaration_number` + backfill.
- `68c1a32d`: wire contract — line command, lot copy, union reads.
- `2ba09d85`: editor Chứng từ trên `/shipments-detail` có trường "Số tờ khai"
  từng cont + nút "Copy số tờ khai sang N cont chưa có số" + test pin.
- Cả ba commit là ancestor của HEAD (main) → UI + nút CÓ trong code.
  Nếu staging không hiển thị → bundle stale (build churn), không phải regression code.
  Bằng chứng rung 3: qa/2026-10-14_tokhai_ui-*.

## Case ID: TC-TOKHAI-AUTOCOPY-01 — auto-copy khi nhập số đầu tiên

Tiền điều kiện: lô FCL ≥ 2 cont, mọi cont chưa có số tờ khai (NULL/empty).

Các bước:
1. `/shipments-detail` → mở editor Chứng từ của cont bất kỳ.
2. Nhập số tờ khai mới (ví dụ `TK-AUTO-1`) → Lưu.
3. Chờ editor đóng + toast success.

Kỳ vọng:
- Số lưu trên cont vừa nhập (DB: `declaration_number = 'TK-AUTO-1'`).
- TỰ ĐỘNG copy sang MỌI cont khác còn trống của cùng lô — đúng một call server
  (`copy-declaration`), không ghi đè cont đã có số.
- Toast: "Đã lưu số tờ khai và tự động copy sang N cont chưa có số."
- Phiên bản lô (version) tăng đúng một lần cho copy (backend đã pin).

## Case ID: TC-TOKHAI-AUTOCOPY-02 — KHÔNG auto-copy khi lô đã có số

Tiền điều kiện: lô có ≥ 2 cont, một cont khác đã có số riêng.

Các bước: nhập/đổi số trên cont này → Lưu.

Kỳ vọng: KHÔNG gọi copy; số của cont khác giữ nguyên (divergence hợp lệ);
không toast copy; nút copy tường minh vẫn có sẵn cho trường hợp còn cont trống.

## Case ID: TC-TOKHAI-AUTOCOPY-03 — copy fail sau khi số đã lưu

Các bước: số tờ khai lưu thành công nhưng call auto-copy fail (non-409).

Kỳ vọng: số VẪN được lưu; editor đóng; toast warning nêu lỗi; nút copy còn
để thử lại thủ công. 409 conflict → self-heal refetch (không throw ra UI).

## Case ID: TC-TOKHAI-BUTTON-04 — nút copy tường minh (regression pin)

Tiền điều kiện: cont có số đã lưu, lô còn cont trống.

Các bước: mở editor Chứng từ cont đó → bấm nút copy.

Kỳ vọng: một call server, toast "Đã copy số tờ khai sang N container chưa có số.",
DB các cont trống nhận số, cont đã có số không đổi. Sau đó sửa riêng từng cont
vẫn được (divergence).

## Case ID: TC-TOKHAI-SINGLE-05 — lô 1 cont KHÔNG auto-copy (review Major 1)

Tiền điều kiện: lô FCL đúng 1 cont, chưa có số.

Các bước: nhập số → Lưu.

Kỳ vọng: KHÔNG gọi copy (bộ lọc "ít nhất 1 cont khác còn trống"), không toast
cảnh báo; `every()` không được thỏa vacuously — backend 409 "Mọi container
trong lô đã có số tờ khai." phải không bao giờ reachable từ auto-copy.

## Kết quả chạy (2026-10-14, branch feat/per-container-tokhai)

| Case | Kết quả | Bằng chứng |
|---|---|---|
| TC-TOKHAI-AUTOCOPY-01 | PASS (UI DRIVEN) | qa/2026-10-14_tokhai_ui-driver.log — toast "Đã lưu số tờ khai và tự động copy sang 1 container chưa có số."; DB cont 4+5 = TK-AUTO-105254549001; qa/2026-10-14_tokhai_ui-{1-editor-open,2-autocopy-toast,3-rows-after-autocopy}.png |
| TC-TOKHAI-AUTOCOPY-02 | PASS (UI DRIVEN) | divergence cont 5 → TK-DIVERGED-5, không toast mới, cont 4 giữ nguyên (log + qa/..._ui-4-diverged.png) |
| TC-TOKHAI-AUTOCOPY-03 | PASS (unit pin) | use-cus-detail.declarations.test.tsx — non-409 fail: save hoàn tất + outcome failed; 409: self-heal refetch |
| TC-TOKHAI-BUTTON-04 | PASS (UI DRIVEN) | nút "Copy số tờ khai sang 1 cont chưa có số" → toast "Đã copy số tờ khai sang 1 container chưa có số." → DB cont 5 nhận lại số (log + qa/..._ui-{5-button-visible,6-button-clicked}.png) |
| TC-TOKHAI-SINGLE-05 | PASS (UI DRIVEN) | lô 1 cont (135, MEDU6141565): lưu TK-SINGLE-135, 0 call copy-declaration, 0 toast — qa/2026-10-14_tokhai_ui-single-cont.log + png |

Unit pin: use-cus-detail.declarations.test.tsx 14/14 (auto-copy 1 call đúng
version; PATCH→LINE→COPY; sibling-có-số không copy; clear không copy; 409
self-heal; non-409 vẫn hoàn tất save; 1-cont không copy).

Môi trường: stack riêng (pg tokhai-throwaway-db :5443, redis :6393, backend
:3012, frontend :7185 với VITE_API_PROXY_TARGET=:3012), tài khoản CUS `cus`,
Bill 105254549001 / cont TCLU5830190 + MEDU7120398. User stack (:3002/:5441)
không bị ảnh hưởng.

Claim staging "UI tờ khai + nút copy biến mất": UI và nút CÓ trong code
(2ba09d85 đã merge main 2026-10-13) và chạy thực tế ở local — báo cáo staging
là bundle stale (build churn), không phải regression code.

## Re-run 2026-10-16 — kanban wave 1016c (FB-085 số tờ khai per-cont + auto-copy)

Implementation status: đã có trên `origin/main` từ dispatch gốc (schema +
migration `20261013210105/06`, ledger UI inline-edit, nút copy "Copy số tờ khai
sang N cont chưa có số", auto-copy fan-out phía server — case
`testplan/cases/case-QA-2026-10-13-261013200312-cus-tokhai-inline-propagate.md`);
wave này chỉ re-run bằng chứng theo §6/§7, không sửa mã.

| Gate | Kết quả | Evidence |
|---|---|---|
| `frontend npx tsc --noEmit` | exit 0 | `qa/2026-10-16_kanban-1016c-fb085_fe-tsc.log` |
| FE vitest declarations + CusContainerLedger ×3 | 53/53 PASS (gồm 4 kịch bản bắt buộc: per-cont edit, copy propagation, diverge-after-copy, single-cont lot unchanged) | `qa/2026-10-16_kanban-1016c-fb085_fe-vitest.log` |
| `backend npx tsc --noEmit` | exit 0 | `qa/2026-10-16_kanban-1016c-fb085_be-tsc.log` |
| BE unit `src/tests/unit/cus-container-declaration-wire.test.ts` | 6/6 PASS | `qa/2026-10-16_kanban-1016c-fb085_be-unit.log` |

Rung giữ nguyên mức 3 của lần drive 2026-10-16 (w3a-r17-verify `cus-fcl_0*.png` +
API GET 0001/0002/0001); lần re-run này là rung ≤2 (chạy pin, không drive UI).
