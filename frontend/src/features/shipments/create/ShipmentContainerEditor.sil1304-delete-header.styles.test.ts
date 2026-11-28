import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SIL-1304 (QA build 61999831, /shipments/:id/edit) — bảng "Thông tin hàng":
// cột xóa cuối mỗi dòng (icon thùng rác) KHÔNG có tiêu đề hiển thị — hàng
// tiêu đề dừng ở 'NGÀY GIỜ ĐÓNG TRẢ *', ô cuối trống (chỉ có span sr-only).
// Luật: tiêu đề cột xóa HIỂN THỊ ('Xóa'), không sr-only — nhãn thấy được =
// tên truy cập của cột.
const tsx = readFileSync(resolve(process.cwd(), 'src/features/shipments/create/ShipmentContainerEditor.tsx'), 'utf8');

describe('ShipmentContainerEditor — cột xóa có tiêu đề hiển thị (SIL-1304)', () => {
  it("header cột xóa là chữ hiển thị 'Xóa', không còn ô tiêu đề trống sr-only", () => {
    expect(tsx).toMatch(/<th scope="col">Xóa<\/th>/);
    expect(tsx).not.toMatch(/<th scope="col"><span className="sr-only">Thao tác<\/span><\/th>/);
  });
});
