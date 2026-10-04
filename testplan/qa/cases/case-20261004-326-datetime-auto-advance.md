# Case QA-2026-10-04-326 — Ô ngày giờ phân đoạn tự nhảy focus khi nhập đủ kí tự (card 20261004_326)

- Card: 20261004_326-datetime-no-auto-advance (UX P3, customer request Zalo 19/09)
- Environment: local dev (:7175) DEV evidence; staging QA rung after cut
- Account: dungnv / Abc123 (Điều vận)
- mutates: none (nhập liệu nháp, không lưu)

## Repro (pre-fix)
1. Đăng nhập dungnv, vào /dispatch-detail, mở "Sửa ô điều phối <container>".
2. Nhóm "Giờ trả hàng": gõ "08" vào ô GIỜ (2 kí tự, đầy) → con trỏ đứng yên, phải TAB/chuột để sang PHÚT.
3. Gõ "02" vào ô NGÀY → không tự nhảy sang THÁNG.

## Expected (post-fix)
- Ô đầy kí tự → focus tự nhảy sang ô kế tiếp theo thứ tự: GIỜ → PHÚT, NGÀY → THÁNG → NĂM.
- Paste chuỗi đầy đủ vẫn phân phối sang các ô con; hợp đồng lưu/chặn lưu giữ nguyên ("Giờ trả hàng chưa hoàn chỉnh…", ISO zone-aware).

## Rungs
- UI DRIVEN: real-typing rung ("08" → activeElement "Phút — Giờ trả hàng"; "02" → "Tháng — Giờ trả hàng"; keydown trusted counted); dialog matrix 1280/1440/1920/2560 + 390.
- TEST VERIFIED: DateTimeSegments.test.tsx 16/16 (red-first paste-unchanged case), TimeSegmentsField 8/8, SplitDateTimeField, DispatchPlanEditorCell 5/5 contracts.
- Staging rung: re-run after staging cut; record buildHash.

## Status
- [x] local visual rung executed (lead) — 04/10
- [ ] staging rung executed (lead)
