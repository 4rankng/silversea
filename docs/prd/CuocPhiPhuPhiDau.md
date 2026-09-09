# Quy tắc tính cước & phụ phí dầu (Báo giá Long Minh)

> **Nguồn chân lý:** `18.7 - BG Long Minh T7.xlsx` — 2 sheet: `18.7` (kỳ áp giá dầu
> 18/7) và `11.7` (kỳ trước, giá dầu 11/7). Đây là **bảng báo giá khách hàng**, không
> phải bảng lương/chi phí nội bộ.
>
> ⚠️ **File là bản MINH HOẠ LOGIC** — dùng để hiểu **cách tính**, không phải bộ dữ liệu
> đầy đủ. Vài ô còn trống (khách chưa điền) là bình thường và **không ảnh hưởng công
> thức**. Nơi nào code hiện tại khác file này thì **file này đúng**.
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
đổi thì toàn bộ cước đổi theo — nhưng hợp đồng không đổi.**

| Nhóm | Tham số | Đổi khi nào |
|------|---------|-------------|
| **Tĩnh** (theo hợp đồng) | `GIÁ GỐC` (`I`), `% chia sẻ`, `KM`, `ĐỊNH MỨC DẦU/KM` (`D`), giá dầu mốc `F` = 17.842,59 | Chỉ khi đàm phán lại hợp đồng |
| **Động** (theo kỳ) | **`GIÁ DẦU KỲ` (`G` = ô `M1`)** — 1 giá trị duy nhất cho cả bảng | Mỗi kỳ áp giá dầu (11/7 → 18/7 → …) |
| **Dẫn xuất** (không nhập tay) | `E` = lít/chuyến, `H` = phụ phí, `J` = cước chia sẻ, `K` = cước cuối, `L` = kiểm tra | Tự tính |

⇒ **Chỉ có đúng 1 ô đầu vào động cho cả 27 dòng cước.** Mọi con số cước trong file
đều là hàm của `M1`. Hệ quả cho thiết kế: lưu **công thức + tham số**, không lưu
cước đã chốt cứng (xem §8.1 — hệ thống hiện đang lưu cứng).

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
> ⚠️ **Lệch chủ ý so với công thức Excel:** file báo giá không có clamp (mọi kỳ trong
> file đều trên mốc nên nhánh này chưa từng xuất hiện). Clamp là **quyết định kinh doanh
> sau Excel** — nơi nào đối chiếu với file thì rule này thắng. Code hiện tại đã có
> `Math.max(0, …)` trong `roundInt()` ⇒ hành vi này **đúng**, giữ nguyên.

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

### 2.8. Công thức rút gọn (dùng để lập trình)

```
Cước 1 chuyến = GiáGốc × (1 + %ChiaSẻ)
              + max(0, (GiáDầuKỳ − 17.842,59) × (KmMộtChiều × 2 × ĐịnhMứcDầu))
```

> `max(0, …)` = chốt 2026-09-09 (Câu 1 = B). Km luôn `× 2` = chốt 2026-09-09 (Câu 4 = A).

---

## 3. Ba tuyến của cùng một khách hàng — không phải ba khách hàng

Mỗi sheet chứa **3 khối bảng giá**. Cả 3 đều thuộc khách hàng **Long Minh**; khác nhau
ở **tuyến / nhà máy đích**, kéo theo khác **quãng đường** và **% chia sẻ**:

| Khối | Tuyến (nhà máy đích) | KM 1 chiều | KM 2 chiều | % chia sẻ | Hệ số nhân `J` |
|------|----------------------|-----------:|-----------:|----------:|---------------:|
| Dòng 2–10 | **海防 – NEWEB** (Hải Phòng – NEWEB) | 130 | 260 | **2 %** | × 102 % |
| Dòng 12–20 | **ASKEY** | 100 | 200 | **4 %** | × 104 % |
| Dòng 22–30 | **SUNRISE + SJ** | 120 | 240 | **2,5 %** | × 102,5 % |

### 3.1. Đối chiếu với master data trong hệ thống

Đã kiểm chứng trong `backend/src/seed/data/`:

- **Khách hàng:** `LONG MINH` — 1 bản ghi trong `customers.ts` (mã `LONGMINH`).
- **Nhà máy:** toàn bộ NEWEB / ASKEY / SUNRISE / SJ TECH nằm trong `factories.ts`,
  **tất cả đều mang `internalCode: "LONG MINH"`** ⇒ là nhà máy đích *của* Long Minh,
  không phải khách hàng độc lập.

| Khối báo giá | Nhà máy thực tế trong hệ thống | Pháp nhân nhận hàng |
|--------------|-------------------------------|---------------------|
| NEWEB | `NEWEB-KHO 1`, `NEWEB-KHO 2`, `NEWEB-KHO 3` | CÔNG TY TNHH NEWEB VIỆT NAM (Hà Nam / Ninh Bình) |
| ASKEY | `ASKEY - XƯỞNG 1`, `ASKEY - XƯỞNG 2` | CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM (Bắc Ninh) |
| SUNRISE + SJ | `SUNRISE`, `SJ TECH` | 2 pháp nhân **khác nhau**, cùng KCN Vân Trung, Bắc Ninh |

⇒ **Quan hệ báo giá không phải 1–1 với nhà máy:** 1 khối giá có thể phủ **nhiều nhà
máy** (NEWEB 3 kho; ASKEY 2 xưởng), thậm chí **nhiều pháp nhân** (SUNRISE và SJ TECH
là 2 công ty riêng nhưng dùng chung 1 khối giá vì cùng khu công nghiệp ⇒ cùng cự ly).
Khoá tra cước là **tuyến**, không phải nhà máy và cũng không phải người nhận hàng.

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
> Đây là **lỗi dữ liệu**, không phải chính sách. Xem §8.

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

1. Lấy giá dầu niêm yết mới (**chưa VAT**, hoặc lấy giá có VAT rồi chia `1,08`).
2. Cập nhật **duy nhất ô `M1`** (hoặc trường `GiáDầuKỳ` trong hệ thống).
3. Toàn bộ `H`, `K`, `L` của cả 3 tuyến tự tính lại.
4. `F` (17.842,59), `I` (giá gốc), `% chia sẻ`, `km`, `định mức dầu` **giữ nguyên** —
   chỉ đổi khi đàm phán lại hợp đồng.
5. Ghi lại **ngày áp giá** (sheet mới, ví dụ `11.7` → `18.7`) để đối chiếu về sau.
   Ghi chú `ÁP 4/7/2026` trong file cho thấy cước có **ngày hiệu lực**, không hồi tố.

> **✅ ĐÃ CHỐT (2026-09-09, Câu 2 = A):** không hồi tố — cước đã phát hành giữ nguyên
> khi kỳ giá dầu mới mở (snapshot + 4 id tham số truy vết). Kèm cơ chế **độ trễ theo
> tuyến**: giá mới áp sau lag days (NEWEB = 1 ngày; ASKEY, SUNRISE+SJ chưa có số) —
> chi tiết [`CauHoiKhachHang_CuocPhi_2026-09-08.md`](CauHoiKhachHang_CuocPhi_2026-09-08.md) Câu 2.

---

## 8. Hiện trạng trong hệ thống — và khoảng trống của tham số động

### 8.1. Bảng cước này ĐÃ có trong hệ thống, nhưng ở dạng chốt cứng

`backend/src/seed/data/pricing.ts` đã chứa **đúng 27 dòng** = 3 tuyến × 9 loại xe,
với các trường `route`, `sharePct`, `size`, `basePrice`, `withSurcharge`.

**Kiểm chứng:** áp công thức §2.8 ngược lại toàn bộ 27 dòng seed, **phần chênh giá dầu
suy ra giống nhau ở cả 27 dòng: ≈ 7.917,41 đ/lít** (dao động ở chữ số thập phân thứ 4
do `withSurcharge` trong seed đã làm tròn về đồng):

```
(withSurcharge − basePrice × (1 + sharePct)) / (km × 2 × địnhMức)  =  7.917,41  (G − F)
```

> ⚠️ **`25.760` là số SUY NGƯỢC, không phải số của khách hàng.** Nó **không xuất hiện ở
> bất kỳ đâu trong file `18.7 - BG Long Minh T7.xlsx`** — đã dò toàn bộ ô, công thức và
> cả XML gốc: 0 kết quả.
>
> Từ dữ liệu chỉ xác định được **phần chênh `G − F`**. Muốn tách ra `G` thì phải **giả
> định** `F` không đổi: `7.917,41 + 17.842,59 = 25.760`. Nếu kỳ đó dùng giá dầu mốc
> khác thì `G` cũng khác. Vì vậy **chỉ `G − F` là dữ kiện; `25.760` là suy luận có điều
> kiện.**

Hai kết luận:

1. **Công thức trong tài liệu này là đúng** — nó tái tạo chính xác từng dòng dữ liệu
   thật đang có trong hệ thống.
2. **Dữ liệu seed thuộc một kỳ giá dầu thứ ba** (chênh 7.917,41 đ/l ⇒ ≈ 25.760 đ/l nếu
   cùng mốc `F`), khác cả 2 sheet của file
   này (11/7 = 21.740; 18/7 = 27.620) ⇒ **cước trong hệ thống đang cũ so với báo giá 18/7.**

| Kỳ | Giá dầu | Nguồn | Loại dữ kiện |
|----|--------:|-------|--------------|
| Seed hệ thống hiện tại | ≈ 25.760 | `backend/src/seed/data/pricing.ts` (bàn giao 30/7, file gốc **không còn trong repo**) | **Suy ngược** — có điều kiện |
| Sheet `11.7` | 21.740 | file báo giá của khách | Đọc trực tiếp |
| Sheet `18.7` | 27.620 | file báo giá của khách (mới nhất) | Đọc trực tiếp |

### 8.2. Khoảng trống: schema chưa có chỗ cho tham số động

Bảng `pricing_tables` (`backend/src/db/schema/pricing.ts`) hiện là:

```
customerId, routeId, price, containerTypeId, rateKey, effectiveDate, …
```

- `price` là **một số đã chốt** — tức `K` (cước gồm phụ phí) đã bị "nướng" cứng.
- **Không có** cột nào cho `giá dầu kỳ`, `định mức dầu`, `km`, `% chia sẻ`, `giá gốc`.

⇒ Mỗi lần giá dầu đổi, cách duy nhất hiện nay là **tính lại ngoài Excel rồi nạp đè
toàn bộ bảng giá** — đúng như những gì file `18.7` / `11.7` đang phản ánh (mỗi kỳ một
sheet mới). Không truy vết được cước đến từ giá dầu nào.

Điểm tích cực: `effectiveDate` đã nằm trong unique index
(`customerId, routeId, containerTypeId|rateKey, effectiveDate`) ⇒ **hệ thống đã hỗ trợ
cước theo kỳ hiệu lực**, phù hợp với ghi chú `ÁP 4/7/2026` trong file.

### 8.3. Hướng bổ sung tham số động (đề xuất — cần chốt)

Để cước tự động theo giá dầu thay vì nạp đè, cần tách 3 nhóm dữ liệu:

| Nhóm | Nội dung | Tần suất đổi |
|------|----------|--------------|
| **Tham số tuyến** | `km`, `% chia sẻ` | Theo hợp đồng |
| **Tham số loại xe** | `định mức dầu/km` | Rất hiếm |
| **Tham số kỳ** | `giá dầu kỳ`, `giá dầu mốc`, `ngày hiệu lực` | **Mỗi kỳ — 1 dòng cho cả bảng** |

Khi đó `price` không lưu nữa mà **tính khi đọc**; hoặc vẫn lưu `price` như bản chốt
(snapshot) nhưng **kèm khoá tham chiếu kỳ giá dầu** để truy vết được.

> ⚠️ Đây là **đề xuất kỹ thuật, chưa được duyệt**. Việc đổi `pricing_tables` ảnh hưởng
> tới cước đã phát hành ⇒ phải chốt §10 trước khi làm.

---

## 9. Ghi chú về dữ liệu trong file

> **File này là bản MINH HOẠ LOGIC, không phải bộ dữ liệu hoàn chỉnh.** Ô trống là bình
> thường — nhiều khả năng khách hàng chưa điền. **Cái cần lấy từ file là công thức và
> cấu trúc**, không phải tính đầy đủ của từng con số.
>
> Vì vậy phần dưới **không phải danh sách lỗi cần sửa**, chỉ là ghi chú khi đọc file.

### 9.1. Thiếu dữ liệu — bình thường, không ảnh hưởng logic

| Điểm | Ghi chú |
|------|---------|
| Dòng `15T` không có `GIÁ GỐC` (cả 3 khối × 2 sheet) | Khách chưa điền. Công thức vẫn đúng; chỉ thiếu 1 tham số đầu vào. Hệ thống rơi về nhánh nhập tay cho tới khi có số. *(Đã lan sang `pricing.ts` dưới dạng `basePrice: 0` — cũng chỉ là dữ liệu trống.)* |
| Tiêu đề cột `G` khối ASKEY / SUNRISE (sheet `18.7`) vẫn ghi `GIÁ DẦU NGÀY 3/4` | Nhãn cũ chưa sửa, nhưng **công thức đã trỏ đúng `$M$1`**. Là file làm việc nên nhãn lệch là bình thường — **lấy công thức, không lấy nhãn**. |
| Sheet `11.7` gõ cứng `21.740` từng dòng thay vì tham chiếu 1 ô | Thói quen làm việc trên Excel. Sheet `18.7` đã chuyển sang `$M$1` — đó mới là cách làm chuẩn cần đưa vào hệ thống. |

### 9.2. Điểm về cách đọc file

| Điểm | Ghi chú |
|------|---------|
| `K` ra số lẻ (vd `1.580.212,59`) | Excel không làm tròn. **Đã chốt: hệ thống làm tròn đến từng đồng** (§10). |
| `PHỤ PHÍ THU` (`L`) = `K − J` = `H` | Cột kiểm tra ngược, **không phải khoản phí thứ ba**. Không cần đưa vào DB. |

### 9.3. Vùng nháp cuối sheet `18.7` (G32:H35)

Không thuộc bảng cước chính — **là ghi chú nháp**, chép lại nguyên trạng để tra cứu:

- `LẠCH HUYỆN 400`, `FIGHTING`
- `GIÁ DẦU * 15` → `27.620 × 15 = 414.300`
- `25.420 × 15 = 381.300` · `352.900 / 15 = 23.526,67` · `+23.320 × 15`
- `ÁP 4/7/2026`

Diễn giải khả dĩ: một tuyến/khoản khác (Lạch Huyện) dùng **định mức cố định 15 lít**
thay cho `km × định mức`. **Nằm ngoài phạm vi bản minh hoạ này** — chỉ xử lý khi khách
đưa yêu cầu cụ thể, không suy đoán để đưa vào thiết kế.

---

## 10. Điểm cần chốt trước khi lập trình

**Về nghiệp vụ cước:**

1. ~~**Làm tròn**~~ — **ĐÃ CHỐT: làm tròn đến từng đồng (VND).** Làm tròn riêng `H` và
   `J`, rồi cộng; đã kiểm chứng không lệch so với làm tròn `K`. Tham số công thức
   (`F`, `G−F`, số lít) **không** làm tròn. Chi tiết:
   [`CuocPhiThietKeDB.md`](CuocPhiThietKeDB.md) §4.2.
2. **Mốc `F` = 19.270/1,08:** VAT 8 % là cố định hay đổi theo chính sách thuế từng thời kỳ?
3. ~~**Chiều rỗng: khi chuyến chỉ chạy 1 chiều, có tính `km × 2` không?**~~ —
   **ĐÃ CHỐT (09/09): Câu 4 = A — luôn `km × 2`** (§2.1).
4. ~~**Giá dầu giảm dưới mốc: `H` âm (giảm cước) hay chặn về 0?**~~ —
   **ĐÃ CHỐT (09/09): Câu 1 = B — kẹp về 0, `H = max(0, …)`** (§2.5).

**Về tham số động (giá dầu theo kỳ):**

5. **Ai cập nhật giá dầu kỳ, và theo nguồn nào?** (giá niêm yết Petrolimex? khách hàng
   thông báo? nhập tay?) — có cần duyệt trước khi áp không?
6. **Kỳ áp giá dầu theo lịch cố định hay bất thường?** File cho thấy 11/7 → 18/7 = 1 tuần,
   nhưng ghi chú `ÁP 4/7/2026` lại là ngày khác.
7. ~~**Cước đã phát hành có bị tính lại khi giá dầu đổi không?** (hồi tố hay chỉ áp
   cho lô mới)~~ — **ĐÃ CHỐT (09/09): Câu 2 = A — không hồi tố, snapshot khi phát
   hành** (§7).
8. **Phạm vi áp dụng của 1 lần đổi giá dầu:** dùng chung 1 giá cho mọi khách hàng /
   mọi tuyến (như ô `M1` hiện nay), hay mỗi khách hàng một giá riêng?
9. **Các khách hàng khác ngoài Long Minh** có dùng đúng mô hình này không (giá gốc ×
   % chia sẻ + phụ phí dầu theo định mức)? Nếu khác thì cần mô hình cước tổng quát hơn.

> Các ô dữ liệu còn trống trong file (vd giá gốc `15T`) **không nằm trong danh sách
> này** — đó là dữ liệu khách chưa điền, không phải quyết định thiết kế (§9.1).
