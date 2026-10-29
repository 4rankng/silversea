# SIL-594 (id 694) — Giá trị vừa lưu không hiển thị ngay — phải tải lại trang mới thấy

- Nguồn: QA Glint (ticket SIL-594) 29/10/2026 — staging vantai.tingting.vip, build c2d740c5.
- Link: plan.tingting.vip SIL-594.

## Tái hiện

1. Đăng nhập staging bằng dungnv (Điều vận), mở /dispatch-detail, tìm container
   MSKU5920028 (lô QA592W-001, lot 291).
2. Nhấn ô SỐ TỜ KHAI (đang hiện TESTBUG1-001), sửa thành TESTBUG1-002, Enter.
3. Ngay sau khi lưu (toast "Đã lưu số tờ khai."): ô vẫn hiện TESTBUG1-001.
4. Tải lại trang / tìm kiếm lại: ô hiện TESTBUG1-002 (đã lưu thành công).
5. Xóa về trống + lưu: ô vẫn hiện TESTBUG1-002; reload mới thấy "Chưa có tờ khai".

Cùng họ với triệu chứng đã ghi nhận ở drawer Chi tiết container trên /dispatch và
sau thao tác xóa container (SIL-555): save-refetch cùng URL không phản ánh giá
trị vừa lưu cho tới khi có một GET mới (reload = revalidate; tìm kiếm lại = đổi
URL/cache key).

## Điều tra (evidence 30/10, local c2d740c5)

- Backend: write commit trước khi trả response (`runShipmentWrite` →
  `runIdempotent` = `await db.transaction`); read-after-write FRESH trên cả 3
  endpoint (`cus-workspace/containers`, `cus-workspace/:id`,
  `dispatch-detail-plan-rows`) — probe API ngay sau write trả giá trị mới.
- FE wiring: `DispatchDeclarationCell.onSaved` → `detailPlan.refresh()` →
  refetch → `setItems` — đúng; requestId guard chống stale overwrite.
- Repro browser local (Playwright chromium + webkit, dev bundle + prod bundle
  `vite build`, backend c2d740c5): FRESH ở mọi cấu hình (hiển thị mới trong
  0.4–1.5s sau save).
- Staging response headers: KHÔNG có Cache-Control / Last-Modified / Age /
  X-Cache-Status (chỉ ETag + Vary: Origin) — GET bị coi là có thể reuse theo
  session cache của browser (fetch `cache:'default'`) hoặc proxy trung gian
  (nginx `proxy_cache_valid` không cần Cache-Control); reload/re-search là 2
  đường tắt chuẩn của class stale-sau-save này (Safari/WebKit nổi tiếng với
  session-cache GET theo URL; QA hay test trên viewport mobile thật).
- Kết luận: transport GET không khai báo no-store ⇒ read-after-write KHÔNG được
  bảo đảm end-to-end; cell hiển thị từ `row` prop nên phụ thuộc hoàn toàn vào
  refetch.

## Kỳ vọng sau fix

- Ngay sau khi lưu, ô hiển thị đúng giá trị vừa lưu (không cần tải lại trang).
- Đọc lại sau ghi (refetch cùng URL) không bao giờ bị cache trả bytes cũ:
  API GET + response đều `no-store` (browser + proxy).
- Clear giá trị → ô hiện "Chưa có tờ khai" ngay sau khi lưu.

## Case ID

- SIL-594-C1: sau save thành công, cell hiển thị giá trị server trả về NGAY
  (trước khi refetch deliver) — echo từ authoritative response.
- SIL-594-C2: clear giá trị → "Chưa có tờ khai" ngay sau khi lưu.
- SIL-594-C3: api client GET fetch mang `cache: 'no-store'` (mọi response API).
- SIL-594-C4: backend đặt `Cache-Control: no-store` trên mọi response `/api`
  (handler + wiring scan: mount là mount '/api' ĐẦU TIÊN trong index.ts).
- SIL-594-C5: rapid re-save khi refetch của save trước vừa land giữa chừng —
  giá trị save sau phải thắng (echo key cả 2 giá trị bị thay — review finding 1).
- SIL-594-C6: save resolve sau khi cell đã đổi sang row container khác — echo
  không được rò sang row mới (review finding 2).
- SIL-594-C7: clear-to-empty rồi external refetch mang giá trị khác — server
  value thắng echo.
- Bổ sung (review finding 6): download GET (getForText/getBlob) cũng
  `cache: 'no-store'`.
