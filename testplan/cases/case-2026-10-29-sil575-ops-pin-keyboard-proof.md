# case-2026-10-29-sil575 — /ops/orders pin: chứng minh keyboard + aria-busy in-flight (residual QA fail 29/10)

- Ticket: SIL-575 (board id 653), lane `fix-sil-a11y2`.
- Repro (QA Glint fail 29/10, build df6047f3): "Trạng thái aria-disabled/
  aria-busy lúc đang chuyển đổi chưa quan sát trực tiếp được (nút ghim đã ổn
  định trước khi xem sau bấm); ghim thuần bàn phím (không bấm chuột trước)
  cũng chưa chứng minh riêng." Hành vi đã đạt (QA xác nhận): ghim → dòng lên
  đầu, aria-pressed, Enter bỏ ghim, focus giữ sau re-sort, reload khôi phục.
- Expected: (1) ghim/bỏ ghim THUẦN BÀN PHÍM (focus + Enter, không chuột) giữ
  focus trên đúng nút của order đó qua re-sort, aria-pressed phản ánh state;
  (2) TRONG LÚC chuyển đổi quan sát được trực tiếp aria-busy="true" +
  aria-disabled="true" trên nút đang bay, KHÔNG có disabled native (nút không
  rời tab order).
- Fix: behavior đã implement từ commit 6c3fae0a (aria-disabled + aria-busy +
  ref-map restore) — round này là PROOF rung 3 mà QA yêu cầu: driver
  `qa/scripts/ui-ops-pin-keyboard-verify-20261029.mjs` (real Enter qua
  puppeteer keyboard, request interception DELAY PATCH 2.5s để cửa sổ
  in-flight đo được + screenshot + DOM dump).
- Pin unit sẵn có (không duplicate): `OpsOrdersPage.test.tsx` — 'keeps keyboard
  focus on the same order pin button through the re-sort' + 'keeps focus on
  the pin button when unpinning' + 'sends one pin update while the previous
  action is pending' (aria-busy mid-flight, không disabled, double-submit
  guard).
- Evidence: `qa/2026-10-29_sil575_ui-driver.log` (8/8 PASS),
  `2026-10-29_sil575_ui-ops-pin-inflight-1280.png` (screenshot trong cửa sổ
  in-flight), `2026-10-29_sil575_ui-inflight-dom.log` (DOM dump aria-busy),
  `qa/2026-10-29_sil575_tsc.log`, `qa/2026-10-29_sil575_vitest.log`.
