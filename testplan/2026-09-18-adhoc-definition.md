# Lệnh chạy ngoài — định nghĩa chuẩn & các quy tắc đã bỏ (2026-09-18)

- **Nguồn:** ruling của user ngày 2026-09-18, sửa lại định nghĩa trên thẻ
  `20260916_3-adhoc-feature-spec-rewrite` (Kanban-PROD/TODO) và
  `docs/prd/MasterDataNhaMay.md` §1, §4.
- **Spec:** `docs/prd/MasterDataNhaMay.md` §4, `docs/prd/QuyTrinhO2C.md` §4.4.
- **Vì sao có file này:** định nghĩa cũ trên board/docs/testplan sai và đã
  khiến case `CUS-SHIP-11` khẳng định một cơ chế không tồn tại. Ghi lại ở đây
  để không tái phát.

## 1. Định nghĩa chuẩn (nguyên văn ruling)

> Lệnh chạy ngoài về cơ bản là những **lô hoặc con hàng không phải do SS tạo
> ra**, mà **đi xin từ bên ngoài** để những hôm **không đủ lệnh, xa nhà** chạy.
> Trường hợp này **chỉ có cước do khách báo và các phí chi hộ**.
> Nó là **một dạng lô hàng đặc biệt được bỏ qua nhiều thao tác hoặc chi phí**.

## 2. Các quy tắc SAI đã bỏ — không được tái sử dụng

| Quy tắc đã bỏ | Vì sao sai |
|---|---|
| "Cuốc vãng lai để tối ưu xe rỗng" | Mục đích không phải tối ưu xe rỗng. Đây là hàng đi xin từ bên ngoài khi thiếu lệnh / chạy xa nhà. Cụm "(Tối ưu xe rỗng)" cũng bị bỏ khỏi nhãn checkbox. |
| "Tích chọn chạy ngoài ⇒ **bypass validation định mức cước phí** để đẩy nhanh lệnh sang Điều vận" | Không có cơ chế bỏ qua kiểm tra cước phí. Việc không áp bảng định mức cước nội bộ là **bản chất của loại lô này** (chỉ cước khách báo + phí chi hộ), không phải một van mở để lưu nhanh. |
| "Lô đủ thông tin hợp lệ vẫn lưu được **khi chưa có định mức cước**" | Phát biểu này mô tả hệ quả như một ngoại lệ được miễn; phát biểu đúng là lô chạy ngoài **không dùng** bảng định mức nội bộ. |

## 3. Bộ case

### TC-ADHOC-DEF-01 — Nhãn cờ chạy ngoài

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Mở `/shipments/new`, nhìn phần đầu form không cần cuộn.
  2. Đọc nhãn checkbox.
- **Kết quả mong đợi (Pass):** nhãn **đúng chữ `Lệnh chạy ngoài`** (không có
  hậu tố "(Tối ưu xe rỗng)"); mặc định không tích; bật/tắt không làm mất dữ
  liệu đã gõ.
- **Kỳ vọng sai (Fail nếu):** nhãn còn "(Tối ưu xe rỗng)"; tắt cờ xoá dữ liệu.
- **Bằng chứng:** ảnh form ở 2 trạng thái cờ.

### TC-ADHOC-DEF-02 — Không có đường "bỏ qua kiểm tra cước phí"

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:**
  1. Bật `Lệnh chạy ngoài`.
  2. Lần lượt lưu với: số container sai ISO-6346, cặp ngày sai/đảo, số
     lượng ≤ 0, trường bắt buộc để trống.
  3. Kiểm tra UI copy + `docs/prd` + `testplan` xem còn mô tả cơ chế bỏ qua
     kiểm tra cước hay không.
- **Kết quả mong đợi (Pass):** mọi lỗi ở bước 2 **vẫn bị chặn** với thông báo
  tiếng Việt cụ thể; **không tồn tại** đường/label nào nói cờ chạy ngoài bỏ
  qua kiểm tra cước phí.
- **Kỳ vọng sai (Fail nếu):** cờ làm lưu được dữ liệu sai; còn chuỗi mô tả
  "bypass"/"bỏ qua kiểm tra cước phí" trong UI copy, docs/prd hoặc testplan.
- **Bằng chứng:** 4 ảnh lỗi + kết quả grep theo `TC-ADHOC-DEF-04`.

### TC-ADHOC-DEF-03 — Doanh thu lô chạy ngoài chỉ gồm cước khách báo + phí chi hộ

- **Vai trò:** `cus` (chứng từ), `ketoan` (đối chiếu)
- **Mức độ:** P0
- **Các bước:**
  1. Tạo một lô chạy ngoài với cước do khách báo và một khoản chi hộ.
  2. Mở chi tiết lô và phần cước; so với một lô chuẩn cùng tuyến.
- **Kết quả mong đợi (Pass):** lô chạy ngoài **không** lấy cước từ bảng định
  mức nội bộ; doanh thu thể hiện đúng cước khách báo + phí chi hộ; các thao
  tác/chi phí thuộc danh sách bỏ qua không phát sinh.
- **Kỳ vọng sai (Fail nếu):** hệ thống áp định mức nội bộ cho lô chạy ngoài,
  hoặc ghi nhận doanh thu ở nhóm khách hàng danh mục.
- **Bằng chứng:** ảnh chi tiết lô + đối chiếu số tiền.

### TC-ADHOC-DEF-04 — Không còn cụm từ sai trong repo

- **Vai trò:** QA (kỹ thuật)
- **Mức độ:** P1
- **Các bước:**
  1. `grep -rni "tối ưu xe rỗng\|toi uu xe rong" docs/ testplan/ frontend/src backend/src shared/src`
  2. `grep -rni "bypass" docs/prd testplan | grep -i "cước\|cước phí"`
- **Kết quả mong đợi (Pass):** bước 1 không còn kết quả nào thuộc ngữ cảnh
  lệnh chạy ngoài; bước 2 không còn câu nào nói cờ chạy ngoài bỏ qua kiểm tra
  cước phí.
- **Kỳ vọng sai (Fail nếu):** còn nơi mô tả sai định nghĩa.
- **Bằng chứng:** dán nguyên văn output grep vào REPORT QA.

## 4. Phạm vi đã sửa theo ruling

- `docs/prd/MasterDataNhaMay.md` §1 (bảng hai luồng), §4 (bản chất), §4.1
  (nhãn + câu mở khoá), §6 tiêu chí 6.
- `docs/prd/QuyTrinhO2C.md` §4.4 (bản chất).
- `testplan/roles/01-cus.md` — `CUS-SHIP-10` (nhãn), `CUS-SHIP-11` (đổi tiêu
  đề: không còn "bypass is scoped to cước phí only").
- `testplan/flows/09-kep-kethop-ghep-chuyen.md` — `TC-ADHOC-001` bước 1 (nhãn).
