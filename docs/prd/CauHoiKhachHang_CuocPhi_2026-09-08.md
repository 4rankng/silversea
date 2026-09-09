# Câu hỏi cần khách hàng trả lời — Bảng cước & Phụ phí dầu (KH Long Minh)

> **Người trả lời:** Anh/chị phụ trách hợp đồng KH Long Minh (CÔNG TY TNHH MỘT
> THÀNH VIÊN LONG MINH), hoặc giám đốc công ty.
>
> **Hạn mong muốn:** trước khi triển khai phát hành lô hàng mới trên bảng cước
> mới (dự kiến cuối tháng 9/2026).

---

## Tóm tắt bối cảnh

Hệ thống đang chuẩn bị chuyển từ cách tính cước cũ sang cách mới, lấy theo đúng
file báo giá `18.7 - BG Long Minh T7.xlsx` mà khách đã cung cấp. Bảng cước này
hiện có 27 dòng = 3 tuyến (Hải Phòng–NEWEB, ASKEY, SUNRISE+SJ) × 9 loại xe
(1.25T, 2.5T, 3.5T, 5T, 8T, 10T, 15T, CONT20, CONT40).

**Công thức cước (theo file Excel):**

```
CƯỚC GỒM PHỤ PHÍ = GIÁ CƯỚC ĐÃ CHIA SẺ + PHỤ PHÍ DẦU
                   = GiáGốc × (1 + % chia sẻ) + (GiáDầuKỳ − GiáDầuMốc) × SốLít
```

Trong đó:

- **Giá gốc** (`I`): cố định theo hợp đồng (ví dụ NEWEB 1.25T = 1.300.000 đ).
- **% chia sẻ**: thay đổi theo từng tuyến — NEWEB = 2%, ASKEY = 4%, SUNRISE+SJ = 2,5%.
- **Giá dầu mốc** = 17.842,59 đ/lít (đã trừ VAT 8%, mặt bằng đã tính sẵn trong giá gốc).
- **Giá dầu kỳ**: thay đổi mỗi kỳ — theo file của khách: 11/7 = 21.740 đ/l; 18/7 =
  27.620 đ/l. *(Hệ thống cũ còn một kỳ nữa, suy ngược ra ≈ 25.760 đ/l — xem Câu 3.)*
- **Số lít** = km một chiều × 2 × định mức dầu/km theo loại xe (ví dụ 1.25T = 0,10 lít/km,
  CONT40 = 0,35 lít/km).

**Trước khi lập trình bảng mới**, cần khách hàng chốt **4 câu hỏi** nghiệp vụ dưới đây
— Câu 1, 2, 4, 5. Mỗi câu ảnh hưởng trực tiếp đến cách tính tiền hoặc hành vi hệ thống.

*(Câu 3 giữ số thứ tự nhưng **đã rút** — đó là việc nội bộ của chúng ta, không phải việc
của khách.)*

> **✅ Trạng thái trả lời (2026-09-09):** khách/công ty đã chốt **Câu 1 = (B), Câu 2 = (A),
> Câu 4 = (A)**. Chỉ còn **Câu 5** chưa trả lời. Bản gửi khách đã được biên tập lại thành
> `(FR) Bảng câu hỏi cho KH.docx` (bản 09/09, 4 câu + phụ lục dữ liệu thiếu 15T) —
> chi tiết từng câu xem khối **ĐÃ TRẢ LỜI** bên dưới.

---

## Câu 1 — Khi giá dầu GIẢM xuống dưới mốc, phụ phí dầu được ÂM hay kẹp về 0?

**Bối cảnh.** Hợp đồng quy định phụ phí dầu là
`H = (giá dầu kỳ − giá dầu mốc) × số lít định mức`. Giá dầu mốc = 17.842,59 đ/lít
(đã trừ VAT, mặt bằng đã tính sẵn trong giá gốc hợp đồng).

Khi giá dầu thị trường xuống dưới mốc này, `H` sẽ ra số **âm**.

**Cần chốt.** Khi đó cước khách trả:

| Lựa chọn | Diễn giải | Ví dụ (NEWEB CONT40, 91 lít) |
|---|---|---|
| **(A) Được âm** — `K = J + H` với `H` có thể âm | Khách được giảm cước đúng bằng phần dầu giảm. Trả đúng theo công thức Excel. | Nếu giá dầu = 16.000 đ/l: H = (16.000 − 17.842,59) × 91 = **−167.676 đ**. Cước = 4.182.000 − 167.676 = **4.014.324 đ** |
| **(B) Kẹp về 0** — `H = max(0, ...)` | Cước không bao giờ thấp hơn `J = I × (1 + % chia sẻ)`. An toàn cho doanh thu nhưng **sai công thức hợp đồng** khi dầu hạ. | Nếu giá dầu = 16.000 đ/l: H = 0. Cước = **4.182.000 đ** |

*(Sửa 2026-09-09: ví dụ phương án A ban đầu ghi −167.516 / 4.014.484 là sai số học;
đúng là (17.842,59 − 16.000) × 91 = 167.675,69 ⇒ −167.676 / 4.014.324 — khớp bản
docx gửi khách 09/09.)*

**Câu cần trả lời:** Khi giá dầu hạ dưới 17.842,59 đ/lít, công ty có chấp nhận
giảm cước cho khách không, hay giữ cước ở mức giá gốc + chia sẻ?

> ### ✅ ĐÃ TRẢ LỜI (2026-09-09) — Phương án (B) — Kẹp về 0
>
> **Quyết định:** khi giá dầu kỳ < mốc 17.842,59 đ/l ⇒ `H = max(0, (G − F) × E) = 0`.
> Cước khách trả không bao giờ thấp hơn `J = I × (1 + % chia sẻ)`.
>
> **Hệ quả thiết kế:**
> - `computeFuelSurcharge()` giữ nguyên clamp `Math.max(0, …)` — đây giờ là **hành vi
>   đúng theo nghiệp vụ**, không phải chi tiết kỹ thuật thừa.
> - Đây là **lệch chủ ý so với công thức Excel** (Excel không có clamp; mọi kỳ trong
>   file đều trên mốc nên Excel chưa gặp nhánh này). Ghi nhận vào PRD tính cước
>   [`CuocPhiPhuPhiDau.md`](CuocPhiPhuPhiDau.md) §2.5.
> - Chứng từ phát hành khi dầu dưới mốc: dòng phụ phí = 0 đ, không hiển thị số âm.

---

## Câu 2 — Khi mở kỳ giá dầu MỚI, cước đã phát hành có bị tính lại không?

**Bối cảnh.** Giá dầu đổi mỗi kỳ (file khách cho thấy 11/7 và 18/7; hệ thống còn một kỳ
cũ hơn).
Mỗi kỳ phụ phí dầu ra số khác nhau.

Câu hỏi: với các lô/chuyến **đã phát hành trước đó** (đã có chứng từ, đã tính tiền),
khi kỳ giá dầu mới mở, cước của các lô cũ có bị tính lại theo kỳ mới hay không?

| Lựa chọn | Diễn giải | Ví dụ |
|---|---|---|
| **(A) Đã chốt là chốt — snapshot** | Cước đã ghi trên chứng từ KHÔNG đổi khi kỳ giá dầu đổi. Hệ thống lưu lại số tiền đã tính lúc phát hành, kèm 4 id tham số để truy vết sau. | Lô phát hành ngày 12/7 (giá dầu 21.740) có phụ phí 350.000 đ. Sang 18/7 giá dầu đổi 27.620 — phụ phí của lô 12/7 vẫn là 350.000 đ, không đổi. |
| **(B) Tính lại mọi lô cũ theo kỳ mới** | Mỗi lần đổi kỳ, chạy lại phụ phí cho toàn bộ lô chưa thanh toán. | Lô 12/7 phụ phí ban đầu 350.000 đ. Sang 18/7 — hệ thống tự tính lại thành 850.000 đ. |

**Câu cần trả lời:** Khi đổi kỳ giá dầu, các lô/chuyến đã phát hành trước đó có
được tính lại cước theo kỳ mới không?

> ### ✅ ĐÃ TRẢ LỜI (2026-09-09) — Phương án (A) — Snapshot (đã chốt là chốt)
>
> **Quyết định:** cước đã ghi trên chứng từ **không** bị tính lại khi kỳ giá dầu mới
> mở. Hệ thống lưu snapshot số tiền đã chốt + 4 id tham số truy vết (thiết kế tại
> [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) §5 — giả định "không hồi tố" nay đã
> được xác nhận).
>
> **Cơ chế "độ trễ" (lag) đi kèm** — bản docx gửi khách 09/09 tổng hợp lại phần khách
> đã trả lời trước đó:
> 1. Hệ thống lưu lịch sử giá dầu theo từng mốc ngày (`fuel_price_periods`).
> 2. Mỗi lần nhập giá mới, so với lần gần nhất để biết có áp giá mới không.
> 3. Giá mới áp sau **số ngày trễ theo tuyến** — NEWEB = **1 ngày** (dầu tăng 9/7 ⇒ áp
>    từ 10/7). Lag của ASKEY, SUNRISE+SJ: **chưa có** (docx còn bỏ trống — phụ lục 2a).
> 4. Cước đã chốt trước thời điểm áp vẫn giữ giá dầu cũ, không tính lại.
>
> ⏳ **Còn chờ khách:** (2a) số ngày trễ của ASKEY / SUNRISE+SJ; (2b) mốc ngày nào của
> lô dùng để chọn kỳ giá dầu (ngày tạo lô / đóng hàng / trả hàng / xuất hoá đơn).

---

## ~~Câu 3~~ — ĐÃ RÚT (không hỏi khách)

**Bối cảnh.** File Excel của khách chỉ cho biết 2 kỳ: 11/7 (21.740 đ/l) và 18/7
(27.620 đ/l).

> ⚠️ **Lưu ý về con số 25.760:** số này **không có trong file Excel của khách** (đã dò
> toàn bộ ô, công thức và XML gốc — không xuất hiện ở đâu). Đây là số **suy ngược** từ
> 27 dòng bảng giá đang nằm trong hệ thống (ngày hiệu lực 2026-07-30, nguồn là **một
> lần bàn giao dữ liệu khác** của khách hồi 30/7).
>
> Chính xác hơn: cái suy ra được chắc chắn từ dữ liệu là **phần chênh `giá dầu kỳ −
> giá dầu mốc` ≈ 7.917,41 đ/lít**. Tách phần chênh này thành 2 số riêng thì **không xác
> định được** — con số 25.760 chỉ đúng **nếu** kỳ đó dùng cùng giá dầu mốc 17.842,59.
> Nếu hợp đồng cũ dùng mốc khác thì giá dầu kỳ cũng khác.

### ⛔ RÚT LẠI — đây không phải câu hỏi dành cho khách hàng

Câu này **đã được rút khỏi danh sách hỏi khách** (2026-09-09).

Lý do: đây là **việc nội bộ của chúng ta**, không phải việc của khách. Khách đã cung cấp
đầy đủ 2 kỳ giá dầu trong file của họ (11/7 và 21.740; 18/7 và 27.620). Kỳ thứ ba là
**dữ liệu cũ nằm trong hệ thống của chúng ta**, đến từ một lần bàn giao trước đó — hỏi
khách về nó là hỏi sai người.

Cách xử lý đúng, **không cần làm phiền khách**:

| Việc | Cách làm |
|------|----------|
| Dựng `fuel_price_periods` | Chỉ nạp **2 kỳ có thật trong file khách**. |
| Dữ liệu 27 dòng seed cũ (30/7) | Giữ nguyên như **snapshot lịch sử đã phát hành**, không cần biết giá dầu kỳ đó là bao nhiêu. |
| Nếu sau này cần đối soát kỳ cũ | Tra chứng từ nội bộ / bản bàn giao 30/7 của chính chúng ta. |

⇒ **Không có gì bị chặn.** Thiếu thông tin kỳ cũ không ảnh hưởng công thức, thiết kế
bảng, hay việc tính cước cho lô mới.

---

## Câu 4 — Chuyến chỉ chạy 1 chiều (không chạy rỗng về): có vẫn tính `km × 2`?

**Bối cảnh.** Công thức Excel hiện luôn tính cước trên **km khứ hồi** =
`km_một_chiều × 2`. Điều này đúng cho chuyến đi rồi chạy rỗng về — phổ biến nhất.

Nhưng có một số trường hợp đặc biệt:
- Chuyến **chỉ chạy 1 chiều** (xe ở lại điểm đích).
- Chuyến **chạy chiều về có hàng** (có hàng chiều ngược lại).

| Lựa chọn | Diễn giải | Ví dụ (NEWEB, km một chiều = 130) |
|---|---|---|
| **(A) Luôn `km × 2`** (theo Excel) | Phù hợp với hợp đồng và công thức Excel. Đơn giản nhất. | Tính trên 260 km bất kể thực tế chạy mấy chiều. |
| **(B) `km × 1` khi chỉ 1 chiều, `km × 2` khi khứ hồi** | Phản ánh đúng quãng đường thực tế. Phức tạp hơn — cần điều chỉnh theo từng chuyến. | Chuyến 1 chiều: tính trên 130 km. Chuyến khứ hồi: tính trên 260 km. |

**Câu cần trả lời:** Khi chuyến thực tế chỉ chạy 1 chiều (không chạy rỗng về),
có vẫn tính cước trên `km × 2` không?

> ### ✅ ĐÃ TRẢ LỜI (2026-09-09) — Phương án (A) — Luôn `km × 2` (theo Excel)
>
> **Quyết định:** cước luôn tính trên km khứ hồi, bất kể thực tế chuyến chạy mấy chiều.
>
> **Lý do (nguyên văn người chốt):** báo cước cho khách không cần quan tâm xe đang ở
> đâu hay có kết hợp ghép chuyến không — cứ theo hợp đồng mà tính; việc tận dụng xe
> là bài toán nội bộ của công ty, không liên quan đến khách.
>
> **Hệ quả thiết kế:** `billing_km_multiplier` = 2 cố định; không cần trường nhập
> "số chiều thực tế" trên lô/chuyến; ghép/Kết hợp không ảnh hưởng cước của từng lệnh.

---

## Câu 5 — Khách hàng khác ngoài Long Minh có dùng cùng mô hình này?

**Bối cảnh.** Mô hình `giá gốc × (1 + % chia sẻ) + phụ phí dầu theo định mức`
hiện đang dựng từ đúng **1 file Excel của 1 khách hàng (Long Minh)**.

Cần biết các khách khác có dùng đúng mô hình này hay có biểu cước khác
(ví dụ: tính theo kg, theo chuyến cố định, theo block giờ, v.v.).

| Lựa chọn | Diễn giải | Ảnh hưởng kỹ thuật |
|---|---|---|
| **(A) Long Minh là duy nhất dùng mô hình này** | Thiết kế đáp ứng đúng cho 1 khách. Khách khác tiếp tục nhập tay như hiện tại. | Đơn giản nhất. |
| **(B) Tất cả khách hàng hiện tại dùng chung mô hình này** | Cần khảo sát bảng giá hiện có của từng khách để biết `% chia sẻ` và `định mức dầu` của họ. | Phải thu thập bảng giá của từng khách. |
| **(C) Một số khách dùng mô hình khác** | Cần phân biệt: khách theo mô hình này, khách theo mô hình khác. | Cần thêm cột phân loại mô hình. |

**Câu cần trả lời:** Khách hàng khác ngoài Long Minh hiện đang dùng biểu cước
nào? Họ có dùng đúng mô hình `giá gốc × (1 + % chia sẻ) + phụ phí dầu` không?

> ⏳ **CHƯA TRẢ LỜI** — câu duy nhất còn treo (cùng phụ lục dữ liệu thiếu: giá gốc 15T
> cho cả 3 tuyến, độ trễ ASKEY/SUNRISE+SJ ở Câu 2).
>
> ☐ Phương án (A) — Chỉ Long Minh dùng mô hình này
> ☐ Phương án (B) — Tất cả khách dùng chung
> ☐ Phương án (C) — Một số khách dùng mô hình khác — kể tên: ___

---

## Hướng dẫn trả lời

Vui lòng đánh dấu ☐ vào phương án chọn cho mỗi câu, hoặc ghi rõ câu trả lời
bằng văn bản. Có thể trả lời từng phần — không cần trả lời hết một lần.

Nếu cần làm rõ thêm về tác động kỹ thuật của từng lựa chọn, vui lòng liên hệ
bộ phận kỹ thuật để được giải thích chi tiết.

Cảm ơn anh/chị đã phối hợp.
