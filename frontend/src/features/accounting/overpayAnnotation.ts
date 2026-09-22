// Re-declared locally to keep this helper import-light for unit tests.
interface OverpayRow {
  tongPhaiThuTra: number;
  daThuTra: number;
}

/** Card 20260922_2 — over-pay annotation: khi số đã thu/trả vượt tổng phí
 *  của đối tượng, trả về cảnh báo hoàn lại phần chênh (từ số liệu dòng,
 *  không bao giờ bị chôn dưới ghi chú tay). */
export function overpayAnnotationOf(row: OverpayRow): string | null {
  if (row.tongPhaiThuTra > 0 && row.daThuTra > row.tongPhaiThuTra) {
    const diff = row.daThuTra - row.tongPhaiThuTra;
    return `Đã thu/trả vượt — cần hoàn lại ${diff.toLocaleString('vi-VN')}`;
  }
  return null;
}
