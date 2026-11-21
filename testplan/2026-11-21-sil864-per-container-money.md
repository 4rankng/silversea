# SIL-864 round 2 — tiền cấp-lô mirror vào cả 2 dòng container, inline-edit đổi CẢ HAI

## Case — hạch toán tách bạch theo từng container (FCL ≥2 cont)

- **Repro (QA verbatim, build 32e22c12, role hoapt, verdict 19:18 SGT):** lô
  K5K5346365, 2 container MNBU0006614 + MNBU0006609 (VĂN LAN). Render 2 dòng
  ĐÃ đạt; fail: Cước thu / Cước trả / Lợi nhuận vẫn MỘT giá trị cấp-lô
  mirror vào cả 2 dòng (baseline: Cước thu 4.160.000₫, Tổng thu 4.160.000₫,
  Tổng trả 1.002₫, Lợi nhuận 4.158.998₫). Inline-edit không save: sửa Cước
  thu dòng MNBU0006609 4.160.000 → 4.161.000 → CẢ HAI dòng thành 4.161.000₫;
  tương tự với MNBU0006614 và Phát sinh ĐV 1.002 → 2.002.
- **Root cause (chứng minh bằng schema + wire):** `shipment_debit_rate_overrides`
  PK = `shipment_id` ("một dòng mỗi lô") — mọi tiền override lưu CẤP LÔ; FE
  tách dòng container (31550ee9) nhưng cả 2 dòng đọc cùng 1 object lô →
  mirror + edit lan truyền.
- **Fix (data model + BE service, không chỉ FE mirror):**
  - Migration `20261121100000_debit_rate_overrides_per_container.sql`: thêm
    `shipment_container_id` (NULL = dòng baseline cấp lô), UNIQUE NULLS NOT
    DISTINCT (shipment_id, shipment_container_id) giữ luật at-most-one-row
    ở tầng DB (PG15+). Dữ liệu cũ giữ NULL = baseline, không backfill.
  - BE `mergeContainerOverrides` (pure): dòng container đè field-by-field
    trên baseline; container không có edit giữ baseline.
  - BE board: `containerMoney` trên wire cho FCL ≥2 cont — từng dòng
    container tính cells riêng từ cùng derived channels; `--itv`-style
    top-level cells GIỮ baseline (Chọn Debit + Debit note đọc tổng cấp lô —
    câu hỏi roll-up per-container lên tổng lô là follow-up owner, nêu
    trade-off trong commit body).
  - BE setter + route: `containerId` (validate thuộc lô, 404 nếu không);
    audit payload mang containerId; idempotency key FE thêm containerId.
  - FE: 4 cụm tiền (Cước phải thu/Tổng thu/Cước phải trả/Tổng trả/Lợi nhuận)
    đọc `rowMoney(row, containerIndex)`; RateCell commit mang containerId
    của ĐÚNG dòng; Chi phí ngoài giữ cấp lô (1 input/lô, shipments.cột).
- **Expected (probe local DB + service thật, lot 170 ×2 container
  TCKU6645693/238 + JZPU8019000/237, role hoapt):**
  1. Board wire mang `containerMoney` 2 entry aligned detailIds [237,238]. ✓
  2. POST rates {containerId: 238, cuocThu: 5.000.000} → 200. ✓
  3. Reload board: cont 238 cuocThu = 5.000.000; cont 237 = baseline; sau
     clear → về baseline. DB đúng 1 dòng (170, 238). ✓
- **Regression pins:** `backend/src/tests/debit-board-container-overrides.test.ts`
  (đúng shape repro QA: 6609 edit 4.161.000/2.002 chỉ dòng đó, 6614 giữ
  4.160.000/1.002, field-by-field fallback),
  `frontend/src/pages/accounting/AccountingDebitClosePage.sil864.test.tsx`
  (2 dòng render tiền riêng + commit mang đúng containerId từng dòng).
- **Trade-off nêu rõ:** KB Ch.10 không nằm trong repo → áp fallback lane:
  giá trị lot GIỮ làm baseline; edit ghi đúng container; mirror của EDIT
  bỏ (mirror baseline giữa các dòng khi chưa có edit vẫn là dữ liệu thật
  cấp lô). Tổng cấp lô (Chọn Debit / Debit note) chưa roll theo per-
  container edit — follow-up owner ruling.
