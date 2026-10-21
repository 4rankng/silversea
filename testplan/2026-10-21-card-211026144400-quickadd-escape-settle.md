# Regression — FB-066 lần 3 flaky: Escape settle popover "Nhà xe" trong quick-add (21/10/2026)

Card: 211026144400. Test: `DispatchAllocationLclDialog.quick-add.test.tsx` —
"lô CHƯA có nhà xe: dialog hỏi Nhà xe — mặc định đội xe nội bộ" (FB-066 lần 3,
card 201026101600). RED-AT-BASE: 21/10 14:3x fail 2/5 tại HEAD 92b2e2bb và 3/5
tại base 536aad6c (cùng nội dung file test); máy idle của máy khác 5/5 pass,
máy này tái hiện 2/5 fail ngay ở idle.

## Case TC-211026144400 — Escape settle popover "Nhà xe" không xác định

- Repro: chạy gate
  `cd frontend && pnpm exec vitest run src/features/dispatch/master-plan/DispatchAllocationLclDialog.quick-add.test.tsx`
  lặp 5 lần. Fail thất thường 2/5 với
  `AssertionError: expected <div role="dialog" name="Nhà xe"> to be null` tại
  dòng `waitFor(toBeNull)` sau Escape — test chạy ~4.3s (cạn hết budget
  `asyncUtilTimeout` 4s của `configure`).
- Root-cause (probe runtime, không suy luận): test bấm
  `fireEvent.keyDown(document.activeElement, { key: 'Escape' })` ngay khi
  option vừa xuất hiện trong DOM, nhưng DOM focus của react-aria-components
  vào listbox là async: khi Escape nổ, `activeElement` đôi khi vẫn là BUTTON
  trigger (ngoài popover portalled ra body). Handler Escape của react-aria
  nằm trên chính popover (`useOverlay` keyboardProps) — event từ trigger
  không bubble qua popover nên popover KHÔNG BAO GIỜ đóng (không phải "chậm
  unmount"): khi focus kịp vào option trước lúc Escape, popover đóng đồng bộ
  ~1ms; khi focus còn ở trigger, popover đứng yên hết 4s.
- Kết luận: artifact mô phỏng thao tác bàn phím trong jsdom của TEST, không
  phải bug production (trên browser thật focus luôn nằm trong menu khi mở,
  Escape chuẩn react-aria đóng bình thường) → chỉ sửa test stability.
- Expected: Escape luôn được bắn vào một phần tử BÊN TRONG popover (đường
  bubble y như bàn phím thật); 4 chỗ `waitFor(toBeNull)` giữ nguyên assertion;
  test async có test-timeout giới hạn đủ rộng để sống sót full-suite dưới load
  nhiều lane (vitest default 5s/test là giới hạn thật đang kẹp các waitFor).
