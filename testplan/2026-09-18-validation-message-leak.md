# Không rò rỉ lỗi nội bộ ra màn hình (2026-09-18)

## Nguyên nhân và phạm vi

User báo (ảnh `/shipments/new`, 5 dòng container bỏ trống "Loại container"):

> fix bug so we dont leak internal errors

Banner đỏ hiện nguyên văn đường dẫn trường nội bộ, lặp một lần cho mỗi dòng:

```
containers.containerTypeId: Loại container là bắt buộc; containers.containerTypeId: … (×5)
```

Ba lỗi cùng nằm trong một đường:

1. **Rò rỉ đường dẫn nội bộ.** `frontend/src/lib/api/errors.ts` dựng lại câu lỗi
   từ `details[].path` và in thẳng đường dẫn đó khi không có nhãn trong `FIELD_VI`
   (`containers.containerTypeId` → in ra đúng như vậy).
2. **Lặp vô ích.** `formatErrorMessage` nối **mọi** issue bằng `'; '` — 5 dòng
   cùng thiếu một trường thành 5 câu giống nhau.
3. **Từ vựng nội bộ của Zod.** Khi message là câu tiếng Anh của Zod
   (`Expected number, received nan`), bản dịch chuyển nguyên văn ra UI.
   Backend cũng nhét đường dẫn vào chính câu `error`:
   `Expected number, received nan (containers.0.containerTypeId)`
   (`backend/src/lib/validation.ts`).

Phạm vi sửa: cách **hiển thị** lỗi. Không đổi HTTP status, không đổi cấu trúc
`details` (vẫn giữ `path`/`message` cho máy đọc), không đổi quy tắc validate.

## Bộ case

### TC-ERRMSG-01 — Không còn đường dẫn trường nội bộ

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:** tạo lô, để trống "Loại container" ở 5 dòng, bấm lưu (hoặc gọi
  thẳng `PUT /api/shipments/:id/containers` với container thiếu `containerTypeId`).
- **Kết quả mong đợi (Pass):** banner/notice **không** chứa chuỗi dạng
  `containers`, `containerTypeId`, `containers.0.…` hay bất kỳ `path` trường nào;
  nội dung là câu tiếng Việt nói rõ dòng nào thiếu gì.
- **Kỳ vọng sai (Fail nếu):** chuỗi `containers.<field>` (có hoặc không có chỉ
  số) xuất hiện trên màn hình.

### TC-ERRMSG-02 — Gộp lỗi trùng, vẫn nêu đúng dòng

- **Vai trò:** `cus` (chứng từ)
- **Mức độ:** P0
- **Các bước:** 5 container cùng thiếu một trường; sau đó 2 container thiếu hai
  trường khác nhau.
- **Kết quả mong đợi (Pass):** cùng một vấn đề hiện **một lần**, kèm danh sách
  dòng: `Container 1, 2, 3, 4, 5: <câu lỗi>`; nhóm khác nhau tách bằng `; `;
  thứ tự xuất hiện giữ nguyên; một dòng duy nhất thì giữ dạng
  `<nhãn dòng> — <câu lỗi>`.
- **Kỳ vọng sai (Fail nếu):** câu lỗi lặp lại y hệt nhiều lần, hoặc mất hẳn ngữ
  cảnh dòng (`Chặng 2 — Số km: …` của form chuyến phải giữ nguyên hành vi).

### TC-ERRMSG-03 — Không đổ JSON/DTO thô ra UI

- **Vai trò:** mọi vai trò
- **Mức độ:** P1
- **Các bước:** mô phỏng body lỗi dạng object lạ
  (`{ error: { code: 'X', internal: true } }`) và dạng issue không có nhãn.
- **Kết quả mong đợi (Pass):** hiện câu tiếng Việt chung (`Dữ liệu không hợp lệ.`
  hoặc message của đối tượng), **không** `JSON.stringify` nội dung thô.
- **Kỳ vọng sai (Fail nếu):** chuỗi JSON có khoá nội bộ hiện trên UI.

### TC-ERRMSG-04 — Hợp đồng API giữ `details` cho máy đọc

- **Vai trò:** API
- **Mức độ:** P0
- **Các bước:** gọi `PUT /api/shipments/:id/containers` với container thiếu
  `containerTypeId`; đọc `error` và `details`.
- **Kết quả mong đợi (Pass):** `details[]` **giữ nguyên** `path` + `message`
  (máy đọc được); trường `error` **không** còn phần `(<path>)`.
- **Kỳ vọng sai (Fail nếu):** `error` còn `(containers.0.containerTypeId)`, hoặc
  `details` bị rút gọn/mất `path`.

### TC-ERRMSG-05 — Chặn hồi quy từng trường hợp

- **Vai trò:** mọi vai trò
- **Mức độ:** P0
- **Các bước:** chạy bộ unit của bộ dịch lỗi.
- **Kết quả mong đợi (Pass):** `frontend/src/lib/api/errors.test.ts` khoá: không
  lộ path, gộp nhóm, nhãn `Chặng N`/`Container N`, câu Zod tiếng Anh được thay
  bằng câu tiếng Việt chung, fallback không dump JSON;
  `backend/src/tests/unit/validation-error-shape.test.ts` khoá `error` không có
  path và `details` vẫn đủ.
- **Kỳ vọng sai (Fail nếu):** test đỏ.

## Ghi chú thực thi

- Bản đồ nhãn `FIELD_VI` giữ nguyên; chỉ **bỏ** đường dẫn khi không tra được nhãn.
- `ARRAY_ROOT_LABELS` (`legs` → `Chặng`, `containers` → `Container`) thay cho
  điều kiện cứng `namedPath.startsWith('legs')` trước đây.
- Câu Zod tiếng Anh bị coi là từ vựng nội bộ → thay bằng `Giá trị không hợp lệ`
  (trừ những câu đã có trong `MSG_VI`).

## Kết quả chạy

_(điền sau khi chạy)_
