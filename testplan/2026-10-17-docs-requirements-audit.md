# 2026-10-17 — Audit: 3 DOCX yêu cầu (LCL spec 15/10 · Hướng dẫn kiểm thử 16/16 · Fix chi phí từng phân hệ)

## Nguồn (đã trích xuất bằng `pandoc --track-changes=all`)

| # | File | Vai trò tài liệu |
|---|---|---|
| 1 | `2026.10.15_Cap_nhat_luong_hang_le.docx` | DEV SPEC luồng Hàng lẻ (LCL) — §I.1–6, §II.1–4 |
| 2 | `161026100000-huong-dan-su-dung-kiem-thu-hang-le-chi-phi.docx` | Hướng dẫn + kịch bản kiểm thử A.1–A.6, B.1–B.6 (staging 16/10) |
| 3 | `Fix lại các chi phí của từng phân hệ.docx` | Fix chi phí theo phân hệ: Lái xe · Ops · Kế toán |

## Phương pháp & bằng chứng

- **Code-read**: grep/đọc source trực tiếp trong checkout này (cột Evidence ghi rõ file).
- **Rung 3 của đợt trước**: trích từ `HANDOFF.md` (đợt full-guide 1016, main `a68d2e04` → prod `edbafb04`) + artifact thật `qa/2026-10-16_fullguide_*`, `qa/2026-10-16_1410262307*` — **không** phải claims của phiên này.
- Phiên này chỉ drive lại surface do chính nó sửa (dòng shadow Chi phí – Quyết toán).

## DOC 1 — DEV SPEC LCL: đã triển khai

| Yêu cầu | Trạng thái | Evidence |
|---|---|---|
| §I.1–2 · §II.1 Danh mục loại xe 1.25T…15T + bảng giá thu/trả theo trọng tải; Xe tải = 100% Xe ngoài | ĐÃ CÓ | `shared/src/types/index.ts:791`, `shared/src/constants/lcl-vehicle-sourcing.test.ts`, `backend/src/services/lcl-grouping.service.ts:735,870` (400 chặn xe nội bộ); card FB-090; A.6 PASS (HANDOFF + `qa/2026-10-16_fullguide_a-lcl-chain.log`) |
| TC-A10 (ticket 161026095800): thêm bảng giá theo Loại xe bị chặn "một trục giá" | ĐÃ SỬA | `backend/src/routes/config/catalog-crud.routes.ts:226` (`validatePricingSelector` chấp nhận cặp class+rateKey chuẩn) + pin `backend/src/tests/pricing-table-selector-axis.test.ts`; HANDOFF "A.6 PASS — TC-A10 xác nhận đã sửa" |
| §II.2.1 Kế hoạch Tổng quát: bỏ "Chưa có cont" (CẢNG NÂNG/HẠ = kho/điểm trả, TỔNG QUAN = [SL][bao bì]·[kg]·[CBM]) | ĐÃ CÓ | card FB-091; A.2 PASS (HANDOFF, `qa/2026-10-16_fullguide_a-results.json`) |
| §II.2.2 Kế hoạch Chi tiết Xe: 3 dòng thông số lẻ, chọn tổng nhanh, popup gán xe (loại xe trả ĐV · BKS thực lọc xe ngoài/xe nội bộ · BKS ảo copy+sửa) | ĐÃ CÓ | card FB-092; commits `870dd211`, `d8585c15` (16/10); A.3 PASS (order 1/2, BKS gõ tay, tag "Ghép (1/2)") |
| §II.2.3 Nhảy tiền trả ĐV: Lô 1 = 100%, Lô 2..N = 0, tag Lẻ·Ghép (i/N); tiền đường xe nội bộ tính 1 lần | ĐÃ CÓ | `lcl-grouping.service.ts` (cost group, FB-092/095); A.3 PASS |
| §II.3.1 Chi tiết lô hàng: THÔNG SỐ CONTAINER hiện loại xe Thu/Trả; PHÂN XE 2 dòng (BKS thực / BKS ảo click-sửa) | ĐÃ CÓ | commit `870dd211` "CUS Chi tiết lô hàng shows the cước classes + 2-line phân xe cell" (16/10, card 161026232339) |
| §II.3.2 Ghép/tách cước thu khách (checkbox + nút, cùng KH chặn, popup loại xe + BKS ảo nhóm) | ĐÃ CÓ | card FB-093; commit `77ca0564` (per-lot tick + BKS ảo pickable); A.4/A.5 PASS; A.7 chặn khác KH PASS mức API (HANDOFF) |
| §II.3.2 Nhảy tiền thu: Lô 1 = 100%, lô 2..0₫ + "Ghép cước cùng Bill X"; TỔNG CHI HỘ lô 2 giữ nguyên (F-2) | ĐÃ CÓ | F-2 (case `2026-10-16-card161026113900-f2-money-override-read.md`, commit `e3286338`); A.4 PASS |
| §II.4 Kế toán: THÔNG SỐ CONTAINER/PHÂN XE (badge cam BKS ảo), PHẢI THU theo nhóm CUS, PHẢI TRẢ theo nhóm ĐV | ĐÃ CÓ | card FB-094; A.5 PASS |
| §II.4 Xuất Debit Note: BKS BẮT BUỘC = billing_truck_no; lọc Nhà xe = actual + cước trả ĐV | ĐÃ CÓ | A.5 PASS (HANDOFF; export test `backend/src/tests/shipment-debit-note-export.test.ts`) |
| §II.4 Edge: Hủy ghép/xóa Lô 1 → chuyển 100% sang Lô 2 | ĐÃ CÓ | card FB-095; HANDOFF "A.9 ĐẠT mức nghiệp vụ (test A12-03/04 + DB)"; commit `d8585c15` |
| (Bổ sung từ guide) TC-A12 lô ghép CHƯA phân bổ không hiện tiền | ĐÃ SỬA | commit `f7bef927` (materialize freight snapshot mức lô); case `testplan/2026-10-16-fullguide-a12-undispatched-merge-money.md` |

## DOC 2 — Hướng dẫn kiểm thử (17 mục): đợt trước đã đóng đủ 17/17

Kết luận từ `HANDOFF.md` entry "Full-guide closed-loop QA 1016 — ALL 17 mục ĐẠT, prod @edbafb04" + artifact local `qa/2026-10-16_fullguide_a-results.json`, `qa/2026-10-16_fullguide_b-results.json`, `qa/2026-10-16_fullguide_a-lcl-chain.log`, `qa/2026-10-16_fullguide_b-acct-close.log`.

| Mục | Trạng thái 16/10 (trong tài liệu) | Kết luận |
|---|---|---|
| TC-A1, A2, A3 | ĐẠT | giữ ĐẠT |
| TC-A4, A6 | CHƯA KIỂM ĐƯỢC | → PASS đợt full-guide (A.3/A.4 rung 3, có log) |
| TC-A5, A8 | ĐẠT (UI) | → PASS A.4/A.5 |
| TC-A7, A9 | CHƯA KIỂM | → PASS (A.7 API 400; A.9 nghiệp vụ + DB) |
| TC-A10 | LỖI | → ĐÃ SỬA (xem trên) |
| TC-B1 | ĐẠT (note redesign) | → B.1 PASS hai bảng |
| TC-B2 | LỖI (141026230710) | → DEV_COMPLETED, recheck PASS (`testplan/2026-10-16-card141026230710-ops-khai-chi-phi-recheck.md`, `qa/2026-10-16_141026230710_*`) |
| TC-B3 | CHƯA KIỂM (chờ B2) | → ĐÃ CÓ cảnh báo, pin `OpsExpenseFormModal.containers.test.tsx:194,239`; rung `qa/2026-10-16_141026230720-r2_VERDICT.md` |
| TC-B4, B5 | ĐẠT (UI) | giữ (FB-096/097) |
| TC-B6 | LỖI (141026230770) | → DEV_COMPLETED rung 3 (`testplan/2026-10-16-card141026230770-*.md`, option B `...-fullguide-b6b-tick-ruling-b.md`, `qa/2026-10-16_fullguide_b6b_*`) |

## DOC 3 — Fix chi phí từng phân hệ

| Yêu cầu | Trạng thái | Evidence |
|---|---|---|
| §1 Lái xe: 2 bảng Chi phí lô hàng/Tiền đường; bỏ người chi; bỏ số/ngày HĐ; 2 tick Hóa đơn/Phiếu thu; bắt buộc chụp biên lai; tiền đường hệ thống tự ghi; thêm chi phí liên tục | ĐÃ CÓ | case `testplan/2026-10-16-card141026230700-driver-chiphi-hai-bang.md` (bảng yêu cầu→việc), B.1 PASS (HANDOFF + `qa/2026-10-16_fullguide_b-results.json`) |
| §2 Ops: mọi Ops điền mọi chi phí; cảnh báo trùng "…NHẬP TRƯỚC ĐÓ…" | ĐÃ CÓ | `frontend/src/features/ops/OpsExpenseFormModal.tsx:266,273` + tests:194,239; B.2 PASS |
| §3a Hoàn cược: tra Bill 4 số cuối → gợi ý → tự điền KH/Hãng tàu | ĐÃ CÓ | card FB-096; B.3 PASS (row id 8) |
| §3b Thêm khoản chi gọn: 2 nhóm NCC=nhà xe, HĐ tùy chọn, thu=trả, nhập liên tục không lưu | ĐÃ CÓ | card FB-097; B.4 PASS |
| §3b "chưa test được chi lô hàng" (FB-098) | ĐÃ XỬ LÝ | điều tra ghi nhận + nút "Khai chi phí" trên chi tiết lô `ShipmentDetailPage.tsx:75`; case `testplan/2026-10-16-card141026230750-loi-thong-tin-lo-khi-khai-chi-phi.md` |
| §3c Kế toán chốt debit giao diện 3 vùng (FB-099) | ĐÃ CÓ | `AccountingDebitClosePage.tsx:337,359` (SummaryRail / Chờ xác nhận / công nợ) + test:228; case `...-card141026230760-*.md` |
| §3d Tạm ứng/hoàn ứng: nút Phê duyệt, tick xác nhận, số âm + Đề nghị thu tiền ứng | ĐÃ CÓ | card FB-100; `forwarderClient.approveAdvanceRequest` + `AdminAdvancesPage.test.tsx:237`; `refundAmount: signedNumeric` (shared/schemas:1640,1648); B.6 (a)(b)(c) PASS rung 3 |
| §3e Công nợ vận tải | **KHOẢNG ĐỂ LẠI CÓ Ý THỨC** | chính tác giả viết "để lại giúp em, tuần sau kiểm tra tiếp" — ngoài scope |

## Residual đã biết (đợt trước ghi nhận, không thuộc 3 docx)

- Ghép cước TRƯỚC khi phát lệnh: dispatch freeze supersede snapshot; leaver không trip hiện 0₫ không note (HANDOFF entry 1016).
- `kanban/TODO/` còn giữ FB-090…FB-100:Drive do chủ sở hữu kéo sang DEV_COMPLETED (môi trường agent chỉ đọc Drive).

## Kết luận

**Cả 3 tài liệu đã được hiện thực hoá trong codebase** (đợt full-guide 1016 + các lane FB-090…FB-100 + commits 16/10). Không phát hiện requirement nào của 3 docx còn thiếu trong source ở thời điểm audit này. Mở rộng duy nhất ngoài scope do tác giả tự cắt: **Công nợ vận tải (doc 3 §3e)**.
