# Quy tắc tính cước và phụ phí dầu — Long Minh

Công thức cước, tham số hợp đồng, định mức dầu, bảng giá gốc và bảng cước thành phẩm
của khách hàng Long Minh trên ba tuyến NEWEB, ASKEY và SUNRISE + SJ. Tài liệu định
nghĩa phần tĩnh của cước; phụ phí dầu là tham số động gắn thêm lên trên (§1.1, §7).

Xem thêm: [lịch sử thay đổi](CHANGELOG.md) · [mục lục PRD](README.md) · [dữ liệu và lịch sử cước](CuocPhiThietKeDB.md) · [phương án tính cước tự động](PhuongAnTinhCuocTuDong.md).

---

## 1. Mô hình tính cước

Phạm vi: cước cơ bản của duy nhất khách hàng `LONG MINH`
(`CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH`, mã `LONGMINH`). Ba khối bảng giá không phải
ba khách hàng mà là ba nhóm tuyến/nhà máy đích của chính Long Minh — xem §3.

Cước khách hàng phải trả cho **1 chuyến** gồm **2 thành phần cộng lại**:

```
CƯỚC GỒM PHỤ PHÍ  =  GIÁ CƯỚC ĐÃ CHIA SẺ  +  PHỤ PHÍ DẦU
                     └──── phần TĨNH ────┘   └── phần ĐỘNG ──┘
```

| Thành phần | Bản chất | Biến động |
|------------|----------|-----------|
| **Giá cước đã chia sẻ** (`J`) | Giá gốc hợp đồng × (1 + % chia sẻ) | Cố định theo hợp đồng |
| **Phụ phí dầu** (`H`) | Phần chênh lệch do giá dầu tăng so với mốc chuẩn | Thay đổi mỗi kỳ áp giá dầu |

`L` (PHỤ PHÍ THU) chỉ là kiểm tra ngược: `L = K − J`, luôn bằng đúng `H`. Đây **không
phải một khoản phí thứ ba**.

### 1.1. Tách tham số tĩnh / động

Cùng một bảng cước cơ bản, giá dầu thay đổi thì kết quả tính mới đổi theo — nhưng hợp
đồng không đổi. Cước đã khóa hoặc đã phát hành không tự tính lại khi mở kỳ giá dầu mới.

| Nhóm | Tham số | Đổi khi nào |
|------|---------|-------------|
| **Tĩnh** (theo hợp đồng) | `GIÁ GỐC` (`I`), `% chia sẻ`, `KM`, `ĐỊNH MỨC DẦU/KM` (`D`), giá dầu mốc `F` = 17.842,59 | Chỉ khi đàm phán lại hợp đồng |
| **Động** (theo kỳ) | **`GIÁ DẦU KỲ` (`G`)** — 1 giá trị duy nhất cho cả bảng | Mỗi kỳ áp giá dầu mới |
| **Dẫn xuất** (không nhập tay) | `E` = lít/chuyến, `H` = phụ phí, `J` = cước chia sẻ, `K` = cước cuối, `L` = kiểm tra | Tự tính |

Chỉ có đúng **một đầu vào động** cho toàn bộ 27 mức cước (3 tuyến × 9 loại xe). Mọi
con số cước đều là hàm của `G`. Sản phẩm cần giữ **công thức và các đầu vào có ngày
hiệu lực** để tính mới, đồng thời giữ **bản cước đã khóa** cùng giá gốc, điều khoản
tuyến, định mức và kỳ dầu đã dùng. Không dùng tổng cước của kỳ cũ làm giá gốc cho kỳ mới.

---

## 2. Các công thức gốc

Ký hiệu chữ cái (`B`, `C`, `D`, `E`, `F`, `G`, `H`, `I`, `J`, `K`, `L`) dùng xuyên
suốt tài liệu và trong các bảng số ở §6.

### 2.1. Số km tính cước — luôn tính 2 chiều

```
C (2 CHIỀU) = B (KM một chiều) × 2
```

Cước tính trên **quãng đường khứ hồi** cho mọi chuyến — kể cả chuyến chỉ chạy một
chiều hoặc chuyến có hàng cả hai chiều; chiều về chạy rỗng vẫn tính đủ. Cước báo theo
hợp đồng, không phụ thuộc việc tận dụng xe hay ghép chuyến (đó là bài toán nội bộ,
không liên quan khách).

### 2.2. Tổng lít dầu / chuyến

```
E (TỔNG LÍT DẦU/CHUYẾN) = C (2 chiều) × D (ĐỊNH MỨC DẦU/KM)
```

`D` là **định mức tiêu hao nhiên liệu theo loại xe** (lít/km), xem §4.

### 2.3. Giá dầu mốc chuẩn (giá gốc đã có trong đơn giá hợp đồng)

```
F (GIÁ DẦU NGÀY 26/2) = 19.270 / 1,08 = 17.842,59 đ/lít
```

- `19.270 đ/lít` = giá dầu niêm yết ngày **26/02/2026**, **đã bao gồm VAT 8%**.
- Chia `1,08` để quy về **giá chưa VAT** — vì cước cũng báo chưa VAT.
- **Đây là hằng số**, đại diện cho mặt bằng giá dầu đã được tính sẵn trong `GIÁ GỐC`.
  Chỉ khi ký lại giá gốc mới được đổi mốc này.

### 2.4. Giá dầu kỳ hiện hành

```
G (GIÁ DẦU KỲ) = giá dầu chưa VAT áp dụng cho kỳ đang tính
```

`G` là **tham số động duy nhất**: đổi `G` thì toàn bộ 27 mức cước của bảng tính lại,
các tham số khác giữ nguyên.

| Kỳ áp giá dầu | Giá dầu kỳ (`G`) | Chênh lệch với mốc (`G − F`) |
|---------------|------------------|------------------------------|
| `11/7/2026` | 21.740 đ/lít | **3.897,41 đ/lít** |
| `18/7/2026` | 27.620 đ/lít | **9.777,41 đ/lít** |

### 2.5. Phụ phí dầu / chuyến

```
H (SỐ TIỀN CHÊNH LỆCH DO GIÁ DẦU TĂNG CAO) = max(0, (G − F) × E)
```

Diễn giải: *(giá dầu kỳ − giá dầu mốc chuẩn) × số lít dầu tiêu hao cả chuyến khứ hồi.*

Chỉ bù **phần chênh**, không tính lại toàn bộ tiền dầu, vì tiền dầu ở mặt bằng
17.842,59 đ/lít đã nằm trong `GIÁ GỐC`.

Phụ phí dầu **không âm**: khi giá dầu kỳ < 17.842,59 đ/lít thì `H = 0` và cước bằng
đúng `J = I × (1 + % chia sẻ)` — công ty **không** giảm cước cho khách khi dầu rẻ.
Ví dụ NEWEB CONT 40 (91 lít/chuyến), giá dầu kỳ 16.000 đ/lít: `H = 0`, cước = 4.182.000 đ.

Phép tính mục tiêu phải kẹp phụ phí về 0 để cước cuối không thấp hơn phần giá gốc đã
chia sẻ.

### 2.6. Giá cước đã chia sẻ

```
J (GIÁ CƯỚC ĐÃ CHIA SẺ) = I (GIÁ GỐC) × (1 + % chia sẻ)
```

`% chia sẻ` là **phần tăng giá theo thoả thuận riêng với từng khách hàng** (xem §3).

### 2.7. Cước cuối cùng

```
K (CƯỚC GỒM PHỤ PHÍ) = J + H
L (PHỤ PHÍ THU)      = K − J   →  luôn = H
```

Làm tròn **riêng `J` và `H` đến từng đồng** rồi mới cộng ra `K`; phần lẻ đúng nửa
đồng làm tròn lên. Giữ đủ độ chính xác của giá dầu mốc, chênh dầu và số lít trong
phép tính để không thay đổi kết quả tiền; mở lại một bản cước phải giải thích được
đúng số tiền đã chốt.

### 2.8. Công thức tổng hợp

```
Cước 1 chuyến = GiáGốc × (1 + %ChiaSẻ)
              + max(0, (GiáDầuKỳ − 17.842,59) × (KmMộtChiều × 2 × ĐịnhMứcDầu))
```

Km luôn `× 2` (§2.1). `17.842,59` là số hiển thị rút gọn của `19270/1,08` (§2.3). Giữ
đủ độ chính xác của giá dầu mốc, số lít và chênh lệch để không đổi kết quả tiền; chỉ
làm tròn riêng `J`, `H` đến đồng rồi cộng ra `K` theo §2.7.

---

## 3. Ba tuyến của cùng một khách hàng — không phải ba khách hàng

Bảng giá của Long Minh gồm **3 khối**, mỗi khối 9 loại xe. Cả 3 đều thuộc khách hàng
**Long Minh**; khác nhau ở **tuyến / nhà máy đích**, kéo theo khác **quãng đường** và
**% chia sẻ**:

| Tuyến (nhà máy đích) | KM 1 chiều | KM 2 chiều | % chia sẻ | Hệ số nhân `J` |
|----------------------|-----------:|-----------:|----------:|---------------:|
| **Hải Phòng – NEWEB** | 130 | 260 | **2 %** | × 102 % |
| **ASKEY** | 100 | 200 | **4 %** | × 104 % |
| **SUNRISE + SJ** | 120 | 240 | **2,5 %** | × 102,5 % |

### 3.1. Nhà máy và bên nhận hàng

Một khách hàng Long Minh có thể giao tới nhiều nhà máy và bên nhận hàng. Sản phẩm
phải giúp người dùng chọn đúng nhóm tuyến của hợp đồng, không tạo ba khách hàng
khác nhau chỉ vì bảng giá có ba khối:

| Khối báo giá | Nhà máy thực tế trong hệ thống | Pháp nhân nhận hàng |
|--------------|-------------------------------|---------------------|
| NEWEB | `NEWEB-KHO 1`, `NEWEB-KHO 2`, `NEWEB-KHO 3` | CÔNG TY TNHH NEWEB VIỆT NAM (Hà Nam / Ninh Bình) |
| ASKEY | `ASKEY - XƯỞNG 1`, `ASKEY - XƯỞNG 2` | CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM (Bắc Ninh) |
| SUNRISE + SJ | `SUNRISE`, `SJ TECH` | 2 pháp nhân **khác nhau**, cùng KCN Vân Trung, Bắc Ninh |

**Quan hệ báo giá không phải 1–1 với nhà máy:** 1 khối giá có thể phủ **nhiều nhà
máy** (NEWEB 3 kho; ASKEY 2 xưởng), thậm chí **nhiều pháp nhân** (SUNRISE và SJ TECH
là 2 công ty riêng nhưng dùng chung 1 khối giá vì cùng khu công nghiệp, do đó cùng cự
ly). Khi tính cước phải xác định đúng **khách hàng, tuyến, loại xe và ngày áp dụng**.
Tên nhà máy hoặc bên nhận hàng không thay thế tuyến được thỏa thuận trong hợp đồng.

### 3.2. Quan sát về cấu trúc giá

- **NEWEB và SUNRISE/SJ dùng chung bảng `GIÁ GỐC`** (1.300.000 / 1.700.000 / …).
  Cước cuối khác nhau chỉ vì **km khác nhau** (260 vs 240, do đó phụ phí dầu khác) và
  **% chia sẻ khác nhau** (2 % vs 2,5 %).
- **ASKEY có `GIÁ GỐC` riêng, thấp hơn NEWEB đúng 100.000 đ/loại xe**, bù lại
  **% chia sẻ cao nhất (4 %)** và quãng đường ngắn nhất (200 km).
- `% chia sẻ` **không phụ thuộc loại xe** — áp chung cho cả khối, tức là **thuộc tính
  của tuyến**, không phải của loại xe.

---

## 4. Định mức dầu theo loại xe

Áp dụng **giống nhau cho cả 3 tuyến** — chỉ phụ thuộc loại xe:

| Loại xe | Định mức `D` (lít/km) |
|---------|----------------------:|
| 1.25T | 0,10 |
| 2.5T | 0,13 |
| 3.5T | 0,13 |
| 5T | 0,15 |
| 8T | 0,20 |
| 10T | 0,24 |
| 15T | 0,30 |
| CONT 20 | 0,32 |
| CONT 40 | 0,35 |

**2.5T và 3.5T dùng chung định mức 0,13** nên phụ phí dầu của hai loại xe này **bằng
nhau**; cước cuối chỉ khác nhau ở `GIÁ GỐC` (chênh 100.000 đ).

---

## 5. Bảng giá gốc (`I`) theo tuyến

| Loại xe | NEWEB | ASKEY | SUNRISE + SJ |
|---------|------:|------:|-------------:|
| 1.25T | 1.300.000 | 1.200.000 | 1.300.000 |
| 2.5T | 1.700.000 | 1.600.000 | 1.700.000 |
| 3.5T | 1.800.000 | 1.700.000 | 1.800.000 |
| 5T | 2.400.000 | 2.300.000 | 2.400.000 |
| 8T | 2.900.000 | 2.800.000 | 2.900.000 |
| 10T | 3.100.000 | 3.000.000 | 3.100.000 |
| **15T** | *—* | *—* | *—* |
| CONT 20 | 3.900.000 | 3.800.000 | 3.900.000 |
| CONT 40 | 4.100.000 | 4.000.000 | 4.100.000 |

**15T chưa có `GIÁ GỐC` ở cả 3 tuyến.** Nếu vẫn áp công thức thì `J = 0` và
`K = H`, tức mức 15T chỉ còn tiền phụ phí dầu. Đó là **dữ liệu còn thiếu**, không phải
chính sách giá: sản phẩm phải báo thiếu giá gốc chứ không được hiển thị `J = 0` hay
`K = H` như một mức giá (xem §9).

---

## 6. Bảng cước thành phẩm

### 6.1. Kỳ áp giá dầu **18/7/2026** — giá dầu 27.620 đ/lít (chênh **9.777,41 đ/lít**)

**NEWEB** — 260 km khứ hồi, chia sẻ 2 %

| Loại xe | Lít/chuyến | Phụ phí dầu `H` | Giá gốc `I` | Cước chia sẻ `J` | **Cước gồm phụ phí `K`** |
|---------|-----------:|----------------:|------------:|-----------------:|--------------------------:|
| 1.25T | 26,0 | 254.213 | 1.300.000 | 1.326.000 | **1.580.213** |
| 2.5T | 33,8 | 330.476 | 1.700.000 | 1.734.000 | **2.064.476** |
| 3.5T | 33,8 | 330.476 | 1.800.000 | 1.836.000 | **2.166.476** |
| 5T | 39,0 | 381.319 | 2.400.000 | 2.448.000 | **2.829.319** |
| 8T | 52,0 | 508.425 | 2.900.000 | 2.958.000 | **3.466.425** |
| 10T | 62,4 | 610.110 | 3.100.000 | 3.162.000 | **3.772.110** |
| 15T | 78,0 | 762.638 | — | — | *(762.638 — thiếu giá gốc)* |
| CONT 20 | 83,2 | 813.480 | 3.900.000 | 3.978.000 | **4.791.480** |
| CONT 40 | 91,0 | 889.744 | 4.100.000 | 4.182.000 | **5.071.744** |

**ASKEY** — 200 km khứ hồi, chia sẻ 4 %

| Loại xe | Lít/chuyến | Phụ phí dầu `H` | Giá gốc `I` | Cước chia sẻ `J` | **Cước gồm phụ phí `K`** |
|---------|-----------:|----------------:|------------:|-----------------:|--------------------------:|
| 1.25T | 20,0 | 195.548 | 1.200.000 | 1.248.000 | **1.443.548** |
| 2.5T | 26,0 | 254.213 | 1.600.000 | 1.664.000 | **1.918.213** |
| 3.5T | 26,0 | 254.213 | 1.700.000 | 1.768.000 | **2.022.213** |
| 5T | 30,0 | 293.322 | 2.300.000 | 2.392.000 | **2.685.322** |
| 8T | 40,0 | 391.096 | 2.800.000 | 2.912.000 | **3.303.096** |
| 10T | 48,0 | 469.316 | 3.000.000 | 3.120.000 | **3.589.316** |
| 15T | 60,0 | 586.644 | — | — | *(586.644 — thiếu giá gốc)* |
| CONT 20 | 64,0 | 625.754 | 3.800.000 | 3.952.000 | **4.577.754** |
| CONT 40 | 70,0 | 684.419 | 4.000.000 | 4.160.000 | **4.844.419** |

**SUNRISE + SJ** — 240 km khứ hồi, chia sẻ 2,5 %

| Loại xe | Lít/chuyến | Phụ phí dầu `H` | Giá gốc `I` | Cước chia sẻ `J` | **Cước gồm phụ phí `K`** |
|---------|-----------:|----------------:|------------:|-----------------:|--------------------------:|
| 1.25T | 24,0 | 234.658 | 1.300.000 | 1.332.500 | **1.567.158** |
| 2.5T | 31,2 | 305.055 | 1.700.000 | 1.742.500 | **2.047.555** |
| 3.5T | 31,2 | 305.055 | 1.800.000 | 1.845.000 | **2.150.055** |
| 5T | 36,0 | 351.987 | 2.400.000 | 2.460.000 | **2.811.987** |
| 8T | 48,0 | 469.316 | 2.900.000 | 2.972.500 | **3.441.816** |
| 10T | 57,6 | 563.179 | 3.100.000 | 3.177.500 | **3.740.679** |
| 15T | 72,0 | 703.973 | — | — | *(703.973 — thiếu giá gốc)* |
| CONT 20 | 76,8 | 750.905 | 3.900.000 | 3.997.500 | **4.748.405** |
| CONT 40 | 84,0 | 821.302 | 4.100.000 | 4.202.500 | **5.023.802** |

### 6.2. Kỳ áp giá dầu **11/7/2026** — giá dầu 21.740 đ/lít (chênh **3.897,41 đ/lít**)

Chỉ khác kỳ 18/7/2026 ở phần **phụ phí dầu**; `GIÁ GỐC`, `% chia sẻ`, `km`, `định mức` giữ nguyên.

| Loại xe | NEWEB `H` → `K` | ASKEY `H` → `K` | SUNRISE+SJ `H` → `K` |
|---------|------------------:|-----------------:|----------------------:|
| 1.25T | 101.333 → **1.427.333** | 77.948 → **1.325.948** | 93.538 → **1.426.038** |
| 2.5T | 131.732 → **1.865.732** | 101.333 → **1.765.333** | 121.599 → **1.864.099** |
| 3.5T | 131.732 → **1.967.732** | 101.333 → **1.869.333** | 121.599 → **1.966.599** |
| 5T | 151.999 → **2.599.999** | 116.922 → **2.508.922** | 140.307 → **2.600.307** |
| 8T | 202.665 → **3.160.665** | 155.896 → **3.067.896** | 187.076 → **3.159.576** |
| 10T | 243.198 → **3.405.198** | 187.076 → **3.307.076** | 224.491 → **3.401.991** |
| 15T | 303.998 → *(303.998 — thiếu giá gốc)* | 233.844 → *(233.844 — thiếu giá gốc)* | 280.613 → *(280.613 — thiếu giá gốc)* |
| CONT 20 | 324.264 → **4.302.264** | 249.434 → **4.201.434** | 299.321 → **4.296.821** |
| CONT 40 | 354.664 → **4.536.664** | 272.819 → **4.432.819** | 327.382 → **4.529.882** |

**So sánh hai kỳ:** giá dầu tăng 21.740 → 27.620 (+5.880 đ/lít) làm phụ phí tăng đúng
`5.880 × E`. Ví dụ CONT 40 NEWEB: `5.880 × 91 = 535.080`, do đó 4.536.664 → 5.071.744.

---

## 7. Cách vận hành khi giá dầu đổi

1. Kế toán/CUS được cấp quyền nhập giá dầu mới, ngày hiệu lực và nguồn công bố.
   Phải biết đó là giá chưa VAT hay đã được quy đổi theo hợp đồng. Không tự đổi
   mốc `19.270 / 1,08` chỉ vì giá thị trường hoặc chính sách thuế thay đổi.
2. Lưu trực tiếp kỳ mới; người dùng nhìn thấy giá, ngày hiệu lực và kết quả lưu.
   Kỳ tương lai được ghi rõ là chưa có hiệu lực. Không có bước gửi duyệt giá.
3. Khi CUS/Điều vận nhập **Ngày vận chuyển**, sản phẩm chọn kỳ theo ngày này trừ
   độ trễ của tuyến, áp điều khoản ngưỡng đã xác định, tính và khóa cước.
4. Giá gốc, % chia sẻ, km, định mức và mốc dầu giữ theo hợp đồng. Mở kỳ dầu mới
   không tự thay cước đã khóa hoặc số đã phát hành cho khách.
5. Đổi Ngày vận chuyển khi hồ sơ còn được phép sửa phải cho thấy cước thay đổi
   thế nào, giữ bản cũ và lý do. Chứng từ đã phát hành không bị âm thầm sửa theo.

Ngày vận chuyển là mốc chọn kỳ giá dầu và thời điểm khóa cước. Không hồi tố cước đã
chốt khi giá dầu đổi. NEWEB áp giá dầu sau **1 ngày** kể từ Ngày vận chuyển; độ trễ
của ASKEY và SUNRISE + SJ chưa xác định — xem §9 và
[phương án tính cước](PhuongAnTinhCuocTuDong.md).

## 8. Thông tin người dùng cần xem và sửa

- Xem giá gốc, % chia sẻ, cự ly tính cước, định mức, giá dầu mốc/kỳ, ngày áp dụng,
  phụ phí và tổng cước trên cùng hồ sơ. Có thể giải thích số tiền cho khách mà
  không phải tính lại ngoài bảng tính.
- Phân biệt cước đang đề xuất, cước đã khóa, giá cuối đàm phán và chứng từ đã
  phát hành. Kế toán có quyền sửa giá cuối trực tiếp với lý do; bản giá tự động
  vẫn giữ để đối soát, không cần người khác duyệt.
- Xem lịch sử thay đổi: ai sửa, khi nào, giá trị cũ/mới, lý do và ngày hiệu lực.
  Nếu người khác đã sửa trong lúc đang mở biểu mẫu, phải đối chiếu trước khi
  lưu; không ghi đè thay đổi mà người dùng chưa nhìn thấy.
- Cùng một lần lưu không tạo hai bản cước hoặc hai khoản tiền khi bấm lại. Nếu
  mất kết nối sau khi gửi mà chưa rõ kết quả, hiển thị trạng thái cần kiểm tra,
  không báo đã lưu hoặc tự gửi lại. Khi chưa gửi được, giữ phần đang nhập trên
  màn hình hiện tại và cho thử lại chủ động sau khi có Internet.
- Bảng cước và lịch sử gọn, dễ so sánh theo tuyến/loại xe trên máy tính; số tiền,
  nhãn và thao tác không bị cắt trên điện thoại/máy tính bảng. Thông tin phụ có
  thể mở thêm; không đặt nhiều lớp thẻ hoặc hướng dẫn dài trước dữ liệu chính.

Chi tiết tại [yêu cầu dữ liệu và lịch sử cước](CuocPhiThietKeDB.md).

## 9. Phân biệt thiếu dữ liệu và giá hợp lệ

Các bảng số trong tài liệu là mốc tham chiếu để đối chiếu kết quả tính, không phải
danh sách giá đầy đủ cho mọi loại xe hoặc mọi hợp đồng, và không phải thông báo giá
dầu hiện hành.

| Trường hợp | Hành vi sản phẩm cần có |
|---|---|
| Giá gốc 15T chưa có ở cả 3 tuyến | Báo thiếu giá gốc. Không báo giá 0 hoặc lấy riêng tiền phụ phí làm tổng cước. Người có quyền có thể nhập giá có căn cứ khi cần. |
| Chưa biết độ trễ, ngưỡng hoặc kỳ dầu phù hợp | Nêu đúng phần còn thiếu; không dùng 0, số minh hoạ hay giá của tuyến/loại xe khác để thay thế. |
| Chưa có Ngày vận chuyển | Có thể lưu thông tin lô; biểu diễn rõ chưa xác định cước, không đặt ngày giả. |
| Giá trị tiền bằng 0 theo công thức đã đủ đầu vào | Hiển thị 0 đúng nghĩa; không nhầm với chưa có dữ liệu hoặc lỗi tải. |
| Nhãn ngày của kỳ không khớp công thức | Đối chiếu đúng kỳ giá mà phép tính sử dụng; không dùng nhãn cũ để chọn sai kỳ. |
| Ghi chú ngoài bảng cước, ví dụ địa điểm Lạch Huyện | Không tự biến thành biểu cước mới khi khách chưa có yêu cầu cụ thể. |

## 10. Điểm còn cần khách hàng làm rõ

Các điểm dưới đây chưa có kết luận của khách hàng. Sản phẩm nêu đúng phần còn thiếu,
không tự chọn giá trị thay thế.

- Ba giá gốc 15T; độ trễ áp giá dầu của ASKEY và SUNRISE + SJ.
- Giá trị ngưỡng % hoặc số tiền/lít cho từng hợp đồng; lấy kỳ liền trước hay mốc
  đang áp qua nhiều kỳ; xử lý kỳ đầu và trường hợp không dùng ngưỡng. Ô trống
  không được coi là xác nhận “luôn áp giá mới”.
- Khách khác có dùng cùng mô hình Long Minh hay biểu giá khác; phạm vi dùng chung
  một nguồn giá dầu; lịch công bố, nguồn và cách quy đổi VAT cho các kỳ tương lai.

Đây là các điều khoản/dữ liệu khách hàng cần làm rõ, không phải phê duyệt nội bộ.
Bỏ bước duyệt không cho phép tự chọn giá hoặc thay đổi hợp đồng chưa được khách xác
nhận. Xem [đầu vào nghiệp vụ còn mở](CuocPhiThietKeDB.md#8-đầu-vào-nghiệp-vụ-còn-mở) và
[quy trình tính cước](PhuongAnTinhCuocTuDong.md).

## 11. Tiêu chí chấp nhận

1. Cước cho các dòng đủ giá gốc khớp bảng tham chiếu đúng kỳ; xem được giá gốc,
   chia sẻ, phụ phí và tổng tiền. Dòng thiếu giá 15T được đánh dấu rõ.
2. Dầu giảm dưới mốc cho phụ phí 0; chuyến một chiều vẫn km×2; làm tròn riêng
   J/H không làm mất hoặc tăng một đồng do rút gọn đầu vào khi hiển thị.
3. Ngày vận chuyển và độ trễ quyết định kỳ được áp; mở kỳ mới không làm thay
   cước đã khóa hoặc chứng từ trước đó.
4. Người có quyền lưu kỳ mới hoặc giá cuối trực tiếp, có lý do/lịch sử khi cần.
   Sai dữ liệu, thiếu quyền và kỳ khóa được giải thích rõ, không thêm bước duyệt.
5. Cùng hồ sơ cho cùng số tiền trên điện thoại, máy tính bảng và máy tính; số
   không bị cắt. Bấm lại hoặc mất kết nối không tạo tiền trùng hay tự gửi lại.


