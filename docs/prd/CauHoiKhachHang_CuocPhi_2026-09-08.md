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
- **Giá dầu kỳ**: thay đổi mỗi kỳ (hiện tại thấy 11/7 = 21.740 đ/l; 18/7 = 27.620 đ/l;
  trong hệ thống cũ có 25.760 đ/l).
- **Số lít** = km một chiều × 2 × định mức dầu/km theo loại xe (ví dụ 1.25T = 0,10 lít/km,
  CONT40 = 0,35 lít/km).

**Trước khi lập trình bảng mới**, cần khách hàng chốt 5 câu hỏi nghiệp vụ dưới
đây. Mỗi câu có ảnh hưởng trực tiếp đến cách tính tiền hoặc hành vi hệ thống.

---

## Câu 1 — Khi giá dầu GIẢM xuống dưới mốc, phụ phí dầu được ÂM hay kẹp về 0?

**Bối cảnh.** Hợp đồng quy định phụ phí dầu là
`H = (giá dầu kỳ − giá dầu mốc) × số lít định mức`. Giá dầu mốc = 17.842,59 đ/lít
(đã trừ VAT, mặt bằng đã tính sẵn trong giá gốc hợp đồng).

Khi giá dầu thị trường xuống dưới mốc này, `H` sẽ ra số **âm**.

**Cần chốt.** Khi đó cước khách trả:

| Lựa chọn | Diễn giải | Ví dụ (NEWEB CONT40, 91 lít) |
|---|---|---|
| **(A) Được âm** — `K = J + H` với `H` có thể âm | Khách được giảm cước đúng bằng phần dầu giảm. Trả đúng theo công thức Excel. | Nếu giá dầu = 16.000 đ/l: H = (16.000 − 17.842,59) × 91 = **−167.516 đ**. Cước = 4.182.000 − 167.516 = **4.014.484 đ** |
| **(B) Kẹp về 0** — `H = max(0, ...)` | Cước không bao giờ thấp hơn `J = I × (1 + % chia sẻ)`. An toàn cho doanh thu nhưng **sai công thức hợp đồng** khi dầu hạ. | Nếu giá dầu = 16.000 đ/l: H = 0. Cước = **4.182.000 đ** |

**Câu cần trả lời:** Khi giá dầu hạ dưới 17.842,59 đ/lít, công ty có chấp nhận
giảm cước cho khách không, hay giữ cước ở mức giá gốc + chia sẻ?

> ☐ Phương án (A) — Được âm
> ☐ Phương án (B) — Kẹp về 0

---

## Câu 2 — Khi mở kỳ giá dầu MỚI, cước đã phát hành có bị tính lại không?

**Bối cảnh.** Giá dầu đổi mỗi kỳ (hiện tại thấy 11/7, 18/7, kỳ 25.760 trong hệ thống).
Mỗi kỳ phụ phí dầu ra số khác nhau.

Câu hỏi: với các lô/chuyến **đã phát hành trước đó** (đã có chứng từ, đã tính tiền),
khi kỳ giá dầu mới mở, cước của các lô cũ có bị tính lại theo kỳ mới hay không?

| Lựa chọn | Diễn giải | Ví dụ |
|---|---|---|
| **(A) Đã chốt là chốt — snapshot** | Cước đã ghi trên chứng từ KHÔNG đổi khi kỳ giá dầu đổi. Hệ thống lưu lại số tiền đã tính lúc phát hành, kèm 4 id tham số để truy vết sau. | Lô phát hành ngày 12/7 (giá dầu 21.740) có phụ phí 350.000 đ. Sang 18/7 giá dầu đổi 27.620 — phụ phí của lô 12/7 vẫn là 350.000 đ, không đổi. |
| **(B) Tính lại mọi lô cũ theo kỳ mới** | Mỗi lần đổi kỳ, chạy lại phụ phí cho toàn bộ lô chưa thanh toán. | Lô 12/7 phụ phí ban đầu 350.000 đ. Sang 18/7 — hệ thống tự tính lại thành 850.000 đ. |

**Câu cần trả lời:** Khi đổi kỳ giá dầu, các lô/chuyến đã phát hành trước đó có
được tính lại cước theo kỳ mới không?

> ☐ Phương án (A) — Snapshot (đã chốt là chốt)
> ☐ Phương án (B) — Tính lại theo kỳ mới

---

## Câu 3 — Kỳ giá dầu 25.760 đ/l trong hệ thống bắt đầu từ ngày nào?

**Bối cảnh.** File Excel của khách chỉ cho biết 2 kỳ: 11/7 (21.740 đ/l) và 18/7
(27.620 đ/l). Trong hệ thống hiện tại có 27 dòng bảng giá với ngày hiệu lực
2026-07-30 và suy ra giá dầu kỳ đó là **25.760 đ/l** — tức là đã từng có một
kỳ giữa 18/7 và 30/7 mà giá dầu là 25.760.

Cần ngày bắt đầu của kỳ này để ghi nhận đầy đủ lịch sử giá dầu (phục vụ đối soát
và truy vết).

| Lựa chọn | Ghi chú |
|---|---|
| **(A) Khách cung cấp ngày thật** | Ví dụ: "áp từ 25/7/2026", "áp từ 28/7/2026", "áp từ 22/7/2026"… |
| **(B) Đặt tạm 2026-07-25** | Ước lượng giữa 18/7 và 30/7. Sai số vài ngày, không ảnh hưởng logic. |
| **(C) Đặt = 2026-07-30** | Kỳ 25.760 đi ngay sau ngày seed bảng giá. Trip nào phát hành trước 30/7 sẽ rơi vào kỳ 27.620. |

**Câu cần trả lời:** Kỳ giá dầu 25.760 đ/l bắt đầu từ ngày nào? Hoặc nếu không
nhớ, dùng tạm phương án nào?

> ☐ Phương án (A) — Ngày thật: ___
> ☐ Phương án (B) — Tạm 2026-07-25
> ☐ Phương án (C) — Tạm 2026-07-30

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

> ☐ Phương án (A) — Luôn `km × 2` (theo Excel)
> ☐ Phương án (B) — Tùy chuyến (`km × 1` hoặc `km × 2`)

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
