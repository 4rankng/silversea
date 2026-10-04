# Case QA-2026-10-04-325 — Preset + Enter lưu và đóng dialog giờ hẹn (card 20261004_325)

- Card: 20261004_325-appointment-preset-enter-not-saving (UI bug P2, QA-found staging 04/10)
- Environment: local dev (:7175) DEV evidence; staging QA rung after cut
- Account: thanhdc / Abc123 (Khách hàng)
- mutates: 1 appointment save on fixture container MSCU1111113 (lô QA325-APPT-01)

## Repro (pre-fix)
1. Đăng nhập thanhdc, mở "Chi tiết" một lô có container, bấm ô "Giờ hẹn đóng/trả".
2. Bấm pill "Ngày kia" + slot "13:30", ấn Enter → dialog VẪN MỞ, banner "Có thay đổi container chưa lưu" (không lưu, không thoát).
3. Đối chứng: nhập tay 10:00 + 05/10/2026 + Enter → lưu + đóng ("Đang lưu..." → "Đã lưu giờ hẹn.").

## Expected (post-fix)
- Preset + Enter lưu và ĐÓNG như nhập tay: toast "Đã lưu giờ hẹn.", popover đóng, trigger cập nhật.
- Nhập tay + Enter giữ nguyên hành vi; Escape không lưu; giá trị giờ lỗi không commit im lặng.
- Banner dirty nói sự thật: preset xong Escape → banner sạch; sửa biển số dở dang → banner sống qua lần lưu hẹn.

## Rungs
- UI DRIVEN: real-tap rung trên fixture 3 container: preset "Ngày kia" + "13:30" + Enter → popoverClosed=true, toast "Đã lưu giờ hẹn.", banner=false (trusted input counted).
- TEST VERIFIED: CusAppointmentPopover.test + CusContainerLedger.test (46/46, pin Enter semantics + dirty truthfulness).
- Staging rung: re-run after staging cut (desktop + mobile); record buildHash.

## Status
- [x] local visual rung executed (lead) — 04/10
- [ ] staging rung executed (lead)
