# Bảng giá — selector 400 & mất rate_key ở đường UPDATE (ticket 161026095800)

Ngày: 2026-10-17. Nhánh: `fix/161026095800-price-selector-400`.
FB-090 đã đóng lỗi CREATE ("một trục giá") nhưng QA thủ công vẫn fail ở
selector khách hàng thật. Reproduce API trực tiếp (local dev, admin):

| Hình dạng | Trước | Sau |
|---|---|---|
| PUT patch đổi `vehicleSizeClassId` KHÔNG kèm `rateKey` | **400** "Mã lớp giá (2.5T) không khớp mã loại xe (5T)" (họ key cũ kế thừa qua `{...current,...data}`) | 200, patch mang cặp denormalized mới |
| PUT edit chuẩn FE (class không đổi, `rateKey:null`) | 200 nhưng **wipe `rate_key` → NULL** (spread `{...data}` vô điều kiện) | 200, `rate_key` giữ = mã loại xe |
| Row bị wipe key (class 5, rate_key NULL) | chiếm slot lane CHUNG → 409 ảo khi tạo row general; tạo trùng lane class → 201 (2 dòng sống cùng selector) | guard lane so khớp theo `vehicleSizeClassId`; wiped row vẫn collide đúng lane |

Nguyên nhân: `rate_key` trên row liên kết class là dữ liệu **denormalized
server-owned**, nhưng đường UPDATE xử lý nó như assertion của client ở cả
chỗ merge lẫn chỗ ghi patch.

## Case hồi quy (pin: `backend/src/tests/pricing-table-selector-update.test.ts`)

- **PTC01** (pure + db): patch chỉ đặt/dịch class (không rateKey) phải được
  chấp nhận — rebase key cũ về NULL rồi denormalize lại; KHÔNG phải 400.
- **PTC02** (db): edit chuẩn FE (class không đổi, `rateKey:null`) phải giữ
  `rate_key` = mã loại xe trong DB (không wipe).
- **PTC03** (db): row bị wipe key vẫn phải collide theo class lane (409
  khi tạo trùng); patch chữa lành khôi phục key.
- Pin FB-090 gốc (`pricing-table-selector-axis.test.ts`) giữ nguyên 6/6.

Kết quả 2026-10-17: PTC01–PTC03 PASS (db, dev local) + 3 pure PASS;
tsc 0 lỗi; 29/29 test scope pricing; lint lỗi tồn tại trước (file người
khác, baseline xác nhận). Liên quan KHÔNG sửa: 161026121500 (tombstone
unique index — nhánh khác), 161026100400, 161026204709.
