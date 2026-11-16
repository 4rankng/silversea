# SIL-838 (id 967) — round-3: dòng '→' tuyến render ĐÚNG dạng pickup → delivery

- **Ticket**: SIL-838 · board /accounting/chot-debit · round-3 (QA FAIL 16/11 19:51 SGT, build dd198999 — chỉ điểm 1; điểm 2–5 đã FIXED, không đụng).

## Round-2 còn thiếu gì (đọc lại QA + probe staging READ-ONLY)

QA kỳ vọng dòng tuyến dạng **'X → Y' (pickup → delivery)**. Round-2 (eb4b8889) landed chuỗi 4 tầng nhưng 2 tầng đầu có thể resolve ra **tên catalog KHÔNG mũi tên** ('KCN QUẾ VÕ, BẮC NINH') và mặt nó trước cặp điểm tác nghiệp. Trên staging, probe (READ-ONLY, hoapt) thấy đủ data để render dạng mũi tên trên ĐÚNG các lot QA nêu:

| Lot | Shape | Data thật |
|---|---|---|
| R3M-KR1/KR2, R3K-J1, R3P-KR1 (FCL, shipment 772/773/738/802) | container có cảng nâng/hạ (intake bắt buộc NOT NULL) | pickup 'Cảng Đình Vũ' + drop 'Cảng Đình Vũ' |
| R3Q-679-B (LCL, 812) | pickupLocation/deliveryLocation (FB-105) | 'CFS Test' → 'ASKEY-XƯỞNG 1' |
| JWLEM26100907 (LCL, 828) | pickupLocation/deliveryLocation | 'GLC' → 'NEWEB' |
| R4B-D3-A (FCL, 880) | trips có canonical pair | 'Bãi Đình Vũ → Bãi Đình Vũ' (đã render ✓ — pipeline không lỗi) |

## Fix — tái cấu trúc chuỗi tier trong `getAccountingDebitBoard` (routeName)

Mọi CẶP (có mũi tên) đứng trên mọi tên catalog (không mũi tên):

1. Cặp cảng nâng → cảng hạ theo container (intake-required; label mới dẫn bằng cặp, fallback route catalog/raw cho container không port legacy).
2. Cặp canonical của trip (origin → destination, đóng băng lúc điều phối, active-trip scope).
3. **MỚI** — cặp điểm tác nghiệp LCL: `pickupLocation → deliveryLocation`.
4. Tên catalog tuyến theo trip (fallback không-mũi tên của round-2, hạ cấp xuống đây — hết quyền che cặp).
5. Tên catalog theo container/raw (container không port legacy).
6. ROUTE_DISPLAY_NAME (lot route).
7. Route canonical của factory site.

Regression: lot nào round-2 resolve được đều vẫn resolve (nội dung giờ có mũi tên hoặc giống hệt — ví R4B-D3-A giữ nguyên 'Bãi Đình Vũ → Bãi Đình Vũ').

## Verification

- **Board local, 3 fixture mô phỏng đúng 3 shape**: FCL ports → 'Cảng Đình Vũ → Cảng VipGreenPort' ✓ · LCL points → 'GLC → NEWEB' ✓ · FCL legacy route-only → 'Thuận Thành' (tên catalog, không regression) ✓. Fixture ĐÃ soft-delete.
- **Staging probe READ-ONLY** (trước fix): tier inputs của đúng 6 lot FAIL khớp bảng trên — sau deploy, các lot đó render: FCL 'Cảng Đình Vũ → Cảng Đình Vũ', LCL 'CFS Test → ASKEY-XƯỞNG 1' / 'GLC → NEWEB'.
- Gates: BE `tsc --noEmit` sạch · pin mới `sil838-route-chain-order.test.ts` **4/4** · debit board units **35/35** · FE sil838 + page tests **31/31**.
- Probe: `testplan/qa/scripts/2026-11-16-sil838-staging-route-probe.mjs` (READ-ONLY) · driver fixture: `qa/2026-11-16_sil838-fixture-board.mjs`.
