# SIL-898 — Phát lệnh hàng loạt vẫn chặn nhầm 'Thiếu trọng tải' ở dòng đủ 5 tấn

Case ID: SIL-898-R8 (QA round 8, staging vantai, role dungnv, /dispatch-detail, 11/2026).

## Reproduction

1. Mở /dispatch-detail, bấm [Phát lệnh hàng loạt], tick 2 dòng 'Đã điều xe'
   R3Q-676-2 (03/11) và R3Q-680-B (04/11) — container RTAU4012043 20'DC.
2. Bấm [Phát lệnh đã chọn (2)].

Staging data at round 8 (audit_logs 15930–16076):

- R3Q-676-2 (shipment 808): container line weight **NULL**, lot weight NULL, chưa từng có
  chuyến; các lô cùng booking R3Q-676-1/-3/-4 đều khai **5000 kg**.
- R3Q-680-B (shipment 810): container line bị ghi **0.00** (lần phát trước nhập 5000 → phát
  thành công → hủy chuyến → dòng trọng lượng bị ghi "0"), lot weight NULL; 3 chuyến đã hủy
  vẫn giữ snapshot **5000 kg**.

## Observed (bug)

Cả 2 dòng chặn 'Thiếu trọng tải — không thể tính giá container…' dù booking khai 5 tấn.

## Expected

Dòng có trọng tải đã khai (theo booking) phải phát lệnh THÀNH CÔNG; bảng tóm tắt từng dòng
giữ nguyên hiển thị trọn (không regress SIL-884).

## Fix law (landed)

`resolveDeclaredCargoWeightKg` — MỘT chuỗi nguồn trọng tải đã khai dùng chung cho freeze giá
và dòng hiển thị:

1. cột trọng tải của container neo — giá trị **0.00 không phải khai báo** (không che nguồn sau);
2. cột trọng tải của lô (fallback 9b0b855f);
3. trọng tải chuyến đã phát GẦN NHẤT của chính lô này (snapshot trip_containers — hủy và
   phát lại không mất số điều vận đã khai);
4. trọng tải khai báo ĐỒNG NHẤT của cả họ booking (cùng khách, cùng gốc số Bill/Booking,
   vd R3Q-676-1/-2/-3/-4) — chỉ kế thừa khi các dòng khai đều bằng một số dương; bất đồng →
   khối lượng thiếu → chặn thật (luật card _58: không bịa số).

Chặn 'Thiếu trọng tải' giữ nguyên cho lô không có nguồn nào ở cả 4 bước.

## Verification (this branch)

- Unit (source-law + pure): `backend/src/tests/unit/lot-pricing-grounds-weight-fallback.test.ts`
  — 8/8 pass (`qa/2026-11-24_sil898-weight-chain_unit.log`).
- Probe trên dữ liệu staging khôi phục: cả 2 lô repro → LOCK CONT20.LIGHT với 5000 kg; lô
  khỏe giữ nguyên; họ bất đồng/lặng im → vẫn MISSING_WEIGHT
  (`qa/2026-11-24_sil898-weight-chain_probe.md`). Dòng hiển thị 808/810 đọc đúng 5 tấn.
