# Quy tắc tính cước & phụ phí dầu (Báo giá Long Minh)

> **Yêu cầu sản phẩm — cập nhật 14/09/2026.** Người có quyền thao tác trực tiếp,
> không qua phê duyệt nội bộ; vẫn kiểm tra dữ liệu, quyền sửa, ngày hiệu lực và kỳ
> đã khóa. Cần Internet để làm việc. Xem [mục lục PRD](README.md).

> **Nguồn đối chiếu công thức:** `18.7 - BG Long Minh T7.xlsx` — 2 sheet: `18.7` (kỳ áp giá dầu
> 18/7) và `11.7` (kỳ trước, giá dầu 11/7). Đây là **bảng báo giá khách hàng**, không
> phải bảng lương/chi phí nội bộ.
>
> ⚠️ **File là bản MINH HOẠ LOGIC** — dùng để hiểu **cách tính**, không phải bộ dữ liệu
> đầy đủ. Vài ô còn trống (khách chưa điền) là bình thường và **không ảnh hưởng công
> thức**. Công thức Excel cùng các quyết định khách hàng bổ sung bên dưới là căn cứ;
> quyết định kẹp phụ phí về 0 ngày 09/09 được ưu tiên khi khác công thức Excel.
>
> **Phạm vi: cước cơ bản của DUY NHẤT 1 khách hàng — `LONG MINH`**
> (`CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH`, mã `LONGMINH`).
> 3 khối bảng trong file **không phải 3 khách hàng**, mà là **3 tuyến / nhóm nhà máy
> đích của chính Long Minh** — xem §3.
>
> File này định nghĩa **phần tĩnh** của cước. Giá dầu là **tham số động** gắn thêm
> lên trên — xem §1.1 và §7.

---

## 1. Mô hình tính cước

Cước khách hàng phải trả cho **1 chuyến** gồm **2 thành phần cộng lại**:

```
CƯỚC GỒM PHỤ PHÍ  =  GIÁ CƯỚC ĐÃ CHIA SẺ  +  PHỤ PHÍ DẦU
                     └──── phần TĨNH ────┘   └── phần ĐỘNG ──┘
```

| Thành phần | Bản chất | Biến động |
|------------|----------|-----------|
| **Giá cước đã chia sẻ** (`J`) | Giá gốc hợp đồng × (1 + % chia sẻ) | Cố định theo hợp đồng |
| **Phụ phí dầu** (`H`) | Phần chênh lệch do giá dầu tăng so với mốc chuẩn | Thay đổi mỗi kỳ áp giá dầu |

`PHỤ PHÍ THU` (cột `L`) chỉ là kiểm tra ngược: `L = K − J`, luôn bằng đúng `H`.
Cột này **không phải một khoản phí thứ ba**.

### 1.1. Tách tham số tĩnh / động

Đây là điểm cốt lõi khi đưa vào hệ thống: **cùng một bảng cước cơ bản, giá dầu thay
đổi thì kết quả tính mới đổi theo — nhưng hợp đồng không đổi.** Cước đã khóa hoặc
đã phát hành không tự tính lại khi mở kỳ giá dầu mới.

| Nhóm | Tham số | Đổi khi nào |
|------|---------|-------------|
| **Tĩnh** (theo hợp đồng) | `GIÁ GỐC` (`I`), `% chia sẻ`, `KM`, `ĐỊNH MỨC DẦU/KM` (`D`), giá dầu mốc `F` = 17.842,59 | Chỉ khi đàm phán lại hợp đồng |
| **Động** (theo kỳ) | **`GIÁ DẦU KỲ` (`G` = ô `M1`)** — 1 giá trị duy nhất cho cả bảng | Mỗi kỳ áp giá dầu (11/7 → 18/7 → …) |
| **Dẫn xuất** (không nhập tay) | `E` = lít/chuyến, `H` = phụ phí, `J` = cước chia sẻ, `K` = cước cuối, `L` = kiểm tra | Tự tính |

⇒ **Chỉ có đúng 1 ô đầu vào động cho cả 27 dòng cước.** Mọi con số cước trong file
đều là hàm của `M1`. Sản phẩm cần giữ **công thức và các đầu vào có ngày hiệu lực**
để tính mới, đồng thời giữ **bản cước đã khóa** cùng giá gốc, điều khoản tuyến,
định mức và kỳ dầu đã dùng. Không dùng tổng cước của kỳ cũ làm giá gốc cho kỳ mới.

---

## 2. Các công thức gốc

Ký hiệu theo đúng cột trong file Excel.

### 2.1. Số km tính cước — luôn tính 2 chiều

```
C (2 CHIỀU) = B (KM một chiều) × 2
```

Cước tính trên **quãng đường khứ hồi**, kể cả khi chiều về chạy rỗng.

> **✅ ĐÃ CHỐT (2026-09-09, Câu 4 = A):** luôn `km × 2` cho mọi chuyến — kể cả chuyến
> chỉ chạy 1 chiều hoặc chiều về có hàng. Báo cước theo hợp đồng, không phụ thuộc việc
> tận dụng xe/ghép chuyến (đó là bài toán nội bộ, không liên quan khách).

### 2.2. Tổng lít dầu / chuyến

```
E (TỔNG LÍT DẦU/CHUYẾN) = C (2 chiều) × D (ĐỊNH MỨC DẦU/KM)
```

`D` là **định mức tiêu hao nhiên liệu theo loại xe** (lít/km), xem §4.

### 2.3. Giá dầu mốc chuẩn (giá gốc đã có trong đơn giá hợp đồng)

```
F (GIÁ DẦU NGÀY 26/2) = 19.270 / 1,08 = 17.842,59 đ/lít
```

- `19.270 đ/lít` = giá dầu niêm yết ngày **26/02**, **đã bao gồm VAT 8%**.
- Chia `1,08` để quy về **giá chưa VAT** — vì cước cũng báo chưa VAT.
- **Đây là hằng số**, đại diện cho mặt bằng giá dầu đã được tính sẵn trong `GIÁ GỐC`.
  Chỉ khi ký lại giá gốc mới được đổi mốc này.

### 2.4. Giá dầu kỳ hiện hành

```
G (GIÁ DẦU NGÀY <kỳ áp>) = $M$1
```

Ô `M1` là **tham số duy nhất của cả sheet** — đổi 1 ô, toàn bộ bảng cước tự cập nhật.

| Sheet | Giá dầu kỳ (`G`) | Chênh lệch với mốc (`G − F`) |
|-------|------------------|------------------------------|
| `11.7` | 21.740 đ/lít | **3.897,41 đ/lít** |
| `18.7` | 27.620 đ/lít | **9.777,41 đ/lít** |

> Ở sheet `11.7`, `G` được gõ cứng `21.740` từng dòng; ở sheet `18.7` đã chuyển sang
> tham chiếu `$M$1`. Cách làm ở sheet `18.7` là chuẩn.

### 2.5. Phụ phí dầu / chuyến

```
H (SỐ TIỀN CHÊNH LỆCH DO GIÁ DẦU TĂNG CAO) = (G − F) × E
```

Diễn giải: *(giá dầu hiện tại − giá dầu mốc chuẩn) × số lít dầu tiêu hao cả chuyến khứ hồi.*

Chỉ bù **phần chênh**, không tính lại toàn bộ tiền dầu, vì tiền dầu ở mặt bằng
17.842,59 đ/lít đã nằm trong `GIÁ GỐC`.

> **✅ ĐÃ CHỐT (2026-09-09, Câu 1 = B) — kẹp về 0 khi dầu hạ dưới mốc:**
>
> ```
> H = max(0, (G − F) × E)
> ```
>
> Khi giá dầu kỳ < 17.842,59 đ/l ⇒ `H = 0`, cước = đúng `J = I × (1 + % chia sẻ)` —
> công ty **không** giảm cước cho khách khi dầu rẻ. Ví dụ NEWEB CONT40 (91 lít), dầu
> 16.000 đ/l: H = 0, cước = 4.182.000 đ.
>
> ⚠️ **Lệch chủ ý so với công thức Excel:** file báo giá chưa kẹp phụ phí về 0 (mọi kỳ trong
> file đều trên mốc nên trường hợp này chưa xuất hiện). Kẹp về 0 là **quyết định kinh doanh
> sau Excel** — nơi nào đối chiếu với file thì quy tắc này thắng. Phép tính mục tiêu
> phải kẹp phụ phí về 0 để cước cuối không thấp hơn phần giá gốc đã chia sẻ.

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

### 2.8. Công thức tổng hợp

```
Cước 1 chuyến = GiáGốc × (1 + %ChiaSẻ)
              + max(0, (GiáDầuKỳ − 17.842,59) × (KmMộtChiều × 2 × ĐịnhMứcDầu))
```

> `max(0, …)` = chốt 2026-09-09 (Câu 1 = B). Km luôn `× 2` = chốt 2026-09-09 (Câu 4 = A).
> `17.842,59` là số hiển thị rút gọn của `19270/1,08`. Giữ đủ độ chính xác của
> giá dầu mốc, số lít và chênh lệch để không đổi kết quả tiền; chỉ làm tròn riêng
> `J`, `H` đến đồng rồi cộng theo §10.

---

## 3. Ba tuyến của cùng một khách hàng — không phải ba khách hàng

Mỗi sheet chứa **3 khối bảng giá**. Cả 3 đều thuộc khách hàng **Long Minh**; khác nhau
ở **tuyến / nhà máy đích**, kéo theo khác **quãng đường** và **% chia sẻ**:

| Khối | Tuyến (nhà máy đích) | KM 1 chiều | KM 2 chiều | % chia sẻ | Hệ số nhân `J` |
|------|----------------------|-----------:|-----------:|----------:|---------------:|
| Dòng 2–10 | **海防 – NEWEB** (Hải Phòng – NEWEB) | 130 | 260 | **2 %** | × 102 % |
| Dòng 12–20 | **ASKEY** | 100 | 200 | **4 %** | × 104 % |
| Dòng 22–30 | **SUNRISE + SJ** | 120 | 240 | **2,5 %** | × 102,5 % |

### 3.1. Nhà máy và bên nhận hàng

Một khách hàng Long Minh có thể giao tới nhiều nhà máy và bên nhận hàng. Sản phẩm
phải giúp người dùng chọn đúng nhóm tuyến của hợp đồng, không tạo ba khách hàng
khác nhau chỉ vì bảng giá có ba khối:

| Khối báo giá | Nhà máy thực tế trong hệ thống | Pháp nhân nhận hàng |
|--------------|-------------------------------|---------------------|
| NEWEB | `NEWEB-KHO 1`, `NEWEB-KHO 2`, `NEWEB-KHO 3` | CÔNG TY TNHH NEWEB VIỆT NAM (Hà Nam / Ninh Bình) |
| ASKEY | `ASKEY - XƯỞNG 1`, `ASKEY - XƯỞNG 2` | CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM (Bắc Ninh) |
| SUNRISE + SJ | `SUNRISE`, `SJ TECH` | 2 pháp nhân **khác nhau**, cùng KCN Vân Trung, Bắc Ninh |

⇒ **Quan hệ báo giá không phải 1–1 với nhà máy:** 1 khối giá có thể phủ **nhiều nhà
máy** (NEWEB 3 kho; ASKEY 2 xưởng), thậm chí **nhiều pháp nhân** (SUNRISE và SJ TECH
là 2 công ty riêng nhưng dùng chung 1 khối giá vì cùng khu công nghiệp ⇒ cùng cự ly).
Khi tính cước phải xác định đúng **khách hàng, tuyến, loại xe và ngày áp dụng**.
Tên nhà máy hoặc bên nhận hàng không thay thế tuyến được thỏa thuận trong hợp đồng.

### 3.2. Quan sát về cấu trúc giá

- **NEWEB và SUNRISE/SJ dùng chung bảng `GIÁ GỐC`** (1.300.000 / 1.700.000 / …).
  Cước cuối khác nhau chỉ vì **km khác nhau** (260 vs 240 ⇒ phụ phí dầu khác) và
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

> **2.5T và 3.5T dùng chung định mức 0,13** ⇒ phụ phí dầu 2 loại xe này **bằng nhau**;
> cước cuối chỉ khác nhau ở `GIÁ GỐC` (chênh 100.000 đ).

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
| **15T** | *(bỏ trống)* | *(bỏ trống)* | *(bỏ trống)* |
| CONT 20 | 3.900.000 | 3.800.000 | 3.900.000 |
| CONT 40 | 4.100.000 | 4.000.000 | 4.100.000 |

> ⚠️ **Dòng 15T thiếu `GIÁ GỐC` ở cả 3 khối, cả 2 sheet.** Công thức vẫn chạy nên
> `J = 0` và `K = H` — tức bảng đang báo giá 15T **chỉ bằng tiền phụ phí dầu**.
> Đây là **dữ liệu còn thiếu**, không phải chính sách giá. Xem §9.

---

## 6. Bảng cước thành phẩm

### 6.1. Kỳ áp giá dầu **18/7** — giá dầu 27.620 đ/lít (chênh **9.777,41 đ/lít**)

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

### 6.2. Kỳ áp giá dầu **11/7** — giá dầu 21.740 đ/lít (chênh **3.897,41 đ/lít**)

Chỉ khác kỳ 18/7 ở phần **phụ phí dầu**; `GIÁ GỐC`, `% chia sẻ`, `km`, `định mức` giữ nguyên.

| Loại xe | NEWEB `H` → `K` | ASKEY `H` → `K` | SUNRISE+SJ `H` → `K` |
|---------|------------------:|-----------------:|----------------------:|
| 1.25T | 101.333 → **1.427.333** | 77.948 → **1.325.948** | 93.538 → **1.426.038** |
| 2.5T | 131.732 → **1.865.732** | 101.333 → **1.765.333** | 121.599 → **1.864.099** |
| 3.5T | 131.732 → **1.967.732** | 101.333 → **1.869.333** | 121.599 → **1.966.599** |
| 5T | 151.999 → **2.599.999** | 116.922 → **2.508.922** | 140.307 → **2.600.307** |
| 8T | 202.665 → **3.160.665** | 155.896 → **3.067.896** | 187.076 → **3.159.576** |
| 10T | 243.198 → **3.405.198** | 187.076 → **3.307.076** | 224.491 → **3.401.991** |
| 15T | 303.998 → *(303.998)* | 233.844 → *(233.844)* | 280.613 → *(280.613)* |
| CONT 20 | 324.264 → **4.302.264** | 249.434 → **4.201.434** | 299.321 → **4.296.821** |
| CONT 40 | 354.664 → **4.536.664** | 272.819 → **4.432.819** | 327.382 → **4.529.882** |

**So sánh 2 kỳ:** giá dầu tăng 21.740 → 27.620 (+5.880 đ/lít) làm phụ phí tăng đúng
`5.880 × E`. Ví dụ CONT 40 NEWEB: `5.880 × 91 = 535.080` ⇒ 4.536.664 → 5.071.744.

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

**Đã ghi nhận:** không hồi tố theo Câu 2=A ngày 09/09; NEWEB áp giá sau **1 ngày**.
Bản phương án khách hàng ngày 09/09, tổng hợp ngày 10/09, chốt **Ngày vận chuyển**
là mốc chọn kỳ và khóa cước. Lag ASKEY/SUNRISE+SJ còn thiếu; xem
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

Bảng Excel là bản minh hoạ logic, không phải danh sách giá đầy đủ cho mọi loại xe
hoặc mọi hợp đồng. Các bảng số bên trên được giữ để đối chiếu, không phải thông
báo giá dầu hiện hành.

| Trường hợp | Hành vi sản phẩm cần có |
|---|---|
| Giá gốc 15T còn trống ở cả 3 tuyến | Báo thiếu giá gốc. Không báo giá 0 hoặc lấy riêng tiền phụ phí làm tổng cước. Người có quyền có thể nhập giá có căn cứ khi cần. |
| Chưa biết lag, ngưỡng hoặc kỳ dầu phù hợp | Nêu đúng phần còn thiếu; không dùng 0, số minh hoạ hay giá của tuyến/loại xe khác để thay thế. |
| Chưa có Ngày vận chuyển | Có thể lưu thông tin lô; biểu diễn rõ chưa xác định cước, không đặt ngày giả. |
| Giá trị tiền bằng 0 theo công thức đã đủ đầu vào | Hiển thị 0 đúng nghĩa; không nhầm với chưa có dữ liệu hoặc lỗi tải. |
| Nhãn ngày trong file khác công thức | Đối chiếu đúng kỳ giá mà phép tính sử dụng; không dùng nhãn cũ để chọn sai kỳ. |
| Ghi chú nháp ngoài bảng cước, như Lạch Huyện | Không tự biến thành biểu cước mới khi khách chưa có yêu cầu cụ thể. |

## 10. Quyết định đã chốt và điểm còn cần khách hàng làm rõ

**Giữ nguyên:**

- Câu 1=B: phụ phí không âm. Câu 2=A: không hồi tố khi dầu đổi. Câu 4=A: luôn km×2.
- NEWEB lag 1 ngày; Ngày vận chuyển quyết định kỳ giá và thời điểm khóa cước.
- Làm tròn **riêng H và J đến từng đồng**, sau đó cộng K. Phần lẻ đúng nửa đồng
  làm tròn lên. Giữ đủ độ chính xác của giá dầu mốc, chênh dầu và số lít để không
  thay đổi kết quả; mở lại bản cước phải giải thích được cùng số tiền đã chốt.

**Chưa chốt:**

- Ba giá gốc 15T; lag ASKEY và SUNRISE+SJ.
- Giá trị ngưỡng % hoặc số tiền/lít cho từng hợp đồng; áp khi **vượt** hay **đạt**
  ngưỡng; lấy kỳ liền trước hay mốc đang áp qua nhiều kỳ; xử lý kỳ đầu và trường
  hợp không dùng ngưỡng. Không coi ô trống là xác nhận “luôn áp giá mới”.
- Khách khác có dùng cùng mô hình Long Minh hay biểu giá khác; phạm vi dùng chung
  một nguồn giá dầu; lịch công bố, nguồn và cách quy đổi VAT cho các kỳ tương lai.

Đây là các điều khoản/dữ liệu khách hàng cần làm rõ, không phải phê duyệt nội bộ.
Xem [câu hỏi khách hàng](CauHoiKhachHang_CuocPhi_2026-09-08.md) và
[quy trình tính cước](PhuongAnTinhCuocTuDong.md). Bỏ bước duyệt không cho phép tự
chọn giá hoặc thay đổi hợp đồng chưa được khách xác nhận.

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
