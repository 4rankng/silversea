# Case: FIX CHI PHÍ lần 2 — 6 mục spec 19/10 + 3 mục §c (PRD rulings)

- **Nguồn spec:** `19.10 - FIX CHI PHÍ.docx` (bản gốc `docs/prd/PhanHeKeToan.md`
  §"Spec gốc — 19.10" + mục `### Mockup:` từng ảnh; §c rulings dòng 107/109/113).
- **Ngày:** 2026-10-21 · **Branch:** `fix-accounting-fix2`.
- **Drivers:** `qa/scripts/2026-10-21-accounting-fix2-*.mjs` · **Evidence:**
  `qa/2026-10-21-accounting-fix2/`.

## Mục & behavior mong đợi (repro steps ngắn)

| # | Mục | Expected |
|---|---|---|
| 1 | Ops khai chi phí — ảnh TÙY CHỌN | POST chi phí không ảnh (chứng cứ thay thế `RECEIPT`) → 201, KHÔNG lỗi "thiếu chứng từ"; form Ops (`OpsExpenseFormModal`) cho photo set rỗng |
| 2 | Format 1,000,000 + tabular-nums mọi ô tiền | Mọi money input là `NumberField grouped` (signed nơi luật FB-100 cho âm); shared primitives `.money`/`.num`/`.record-table .num`/`.ds-field--money input` khai `font-variant-numeric: tabular-nums` (font hiện chưa có tnum — declaration inert, ghi nhận) |
| 3 | Phơi phiếu → Xem chi tiết → Thêm dòng: 2 tab "Tiền đường \| Chi phí lô hàng" | Dialog tiền đường → "+ Thêm dòng" → ExpenseCreateDrawer với đúng 2 tab cạnh nhau |
| 4 | BÁO CÁO THU / TRẢ PHƠI (đổi tên) + Lập phiếu thu/chi | Section heading "Báo cáo thu / trả phơi — Ngày … – …"; click tên nhà xe → drawer lô chưa thanh toán; checkbox chọn/chọn-all + STK + "Lập phiếu thu/chi (N)" |
| 5 | Chốt debit: chọn-all cột / highlight dòng / Ngày tick | Bật hết cột → không cell header vỡ (zero-width=0); click dòng → `data-selected` + td accent `#E8F8EE` + ✓ trong ô Ngày; "Chọn Debit" dialog nhóm THEO NGÀY, mỗi ngày một tick |
| 6 | Xuất debit | Chọn lô → "Xuất Debit Note" (Khóa & Xuất nếu chưa khóa) → banner "Đã xuất Debit Note (…)", download bắt đầu, GET export 200 + bytes xlsx PK hợp lệ, DB có row billing_documents |
| 7 | Duyệt tạm ứng → khớp số | Ketoan PHÊ DUYỆT TẠM ỨNG = giải ngân; fund-book `opsAdvance.totalOutstanding` == reconciliation report `totals.remaining` (cả trước & sau duyệt phiếu hoàn ứng) |
| 8 | Hoàn ứng ÂM | Báo cáo hoàn ứng dòng `remainingSigned < 0` → `needsCollection` + direction `CTY_YEU_CAU_THU_TIEN_UNG`; UI /accounting/hoan-ung hiện "ÂM — đề nghị thu lại tiền ứng" |
| 9 | Ops chi phí hiện phía KT | Phiếu hoàn ứng Ops (mang đúng tripExpenseId) hiện trong /advance-settlements kế toán; báo cáo hoàn ứng có dòng nhân viên Ops |

## Regression pins (tests)

- `frontend/src/pages/money-format-sweep.chiphi2.test.ts` — CP2-M4/M5/M6 (sweep lan 2).
- `frontend/src/styles/font-family-contract.test.ts` — tabular-nums chỉ ở shared money primitives.
- `frontend/src/pages/accounting/PhoiPhieuControlPage.report-section.test.tsx` — heading mang khoảng ngày.
- `frontend/src/pages/accounting/AccountingDebitClosePage.chiphi2.test.tsx` — CP2-D1..D4 (có sẵn, giữ nguyên).
- `frontend/src/pages/accounting/OpsReconciliationReportPage.test.tsx` — warning âm (có sẵn).

## Ghi chú §c (không sửa flow)

- PRD dòng 107: duyệt tạm ứng mô tả là "cột tick Ngày duyệt (tích all/từng dòng)";
  hiện trường là nút "PHÊ DUYỆT TẠM ỨNG" từng dòng + tab "Chờ duyệt" — bề mặt
  đã owner-QA (181026183600). Invariant số (khớp Sổ quỹ ↔ báo cáo) là phần
  bắt buộc và đã verify PASS cả 2 thời điểm; đổi cơ chế UI sang cột tick là
  quyết định owner, không tự làm.
- Dòng 117 "(hiện cảnh báo, không hiện số âm trần trụi)": hiện trường hiển thị
  số có dấu ĐỎ + nhãn "ÂM — đề nghị thu lại tiền ứng" theo luật owner
  card 141026230770 (signed value là giá trị, D02) — cảnh báo có mặt, số âm
  vẫn hiện có dấu. Ghi nhận chênh wording spec vs owner ruling.
