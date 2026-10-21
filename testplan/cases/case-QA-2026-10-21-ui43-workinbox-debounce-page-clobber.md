# Case QA-2026-10-21-ui43-workinbox-debounce-page-clobber — tick debounce search vô điều kiện phá page URL-restored

Card `t_f21689bd` — test UI43 `RoleWorkInbox > preserves restored queue and page
through first asynchronous customer scope hydration (UI43)` flaky ~50% trên
main 1f650a59 (2 pass / 2 fail trong 4 run isolation; full-FE thỉnh thoảng đỏ).

## Trạng thái trước fix

Component KHÔNG bắn fetch không scope (scope gate `RoleWorkInbox.tsx` `load`
`if (role === 'customer' && !scopeReady) return` hoạt động đúng — mọi call đều
mang `customerId=7`). Defect thật: effect debounce search chạy `setSearch +
setPage(1)` **vô điều kiện** trên mount tick +350ms → phá page URL-restored:

```
Repro instrumented (faillng, t0 = mount):
  +43ms  /portal/work-inbox?view=WAITING&page=2&limit=100&customerId=7
  +309ms /portal/work-inbox?view=WAITING&page=2&limit=100&customerId=7
  +435ms /portal/work-inbox?view=WAITING&page=1&limit=100&customerId=7   ← clobber
```

Test flaky vì cửa sổ quan sát cũ (waitFor ≥2 + sleep cố định 60ms) đôi khi
nằm trước mốc 350ms (green), đôi khi sau (red) — race là quan sát, defect là
thành phần. Cùng lỗi ở đầu test: nếu findByText chậm >350ms thì page đã bị
reset trước rerender hydration → fail tại assertion toEqual (page=1) thay vì
dòng 124.

## Expected (sau fix)

| ID | Bước | Kỳ vọng |
|---|---|---|
| UI43-R1 | Mount `/portal/shipments?tab=1&page=2`, `scopeReady=false` | 0 apiGet (scope gate giữ nguyên) |
| UI43-R2 | Hydration `customerId=7` + ready | đúng 1 fetch `view=WAITING&page=2&…&customerId=7` |
| UI43-R3 | Toggle scope false→ready (hydration giả lập) | fetch phụ vẫn `page=2` + scoped; tổng ≤3; KHÔNG BAO GIỜ call thiếu `customerId` |
| UI43-R4 | Quan sát tới ≥700ms sau mount (qua chân debounce 350ms) | KHÔNG có fetch `page=1`; location vẫn `?tab=1&page=2` — tick debounce không đổi search → không reset page |
| UI43-R5 | OPS search gõ `MSBU1245657` (fake timers 400ms) | debounce 350ms VẪN đặt `search=` + `page=1` như cũ (không regression chức năng search) |

## Fix

- `frontend/src/components/work-inbox/RoleWorkInbox.tsx`: effect debounce chỉ
  lên lịch `setPage(1)` khi `searchInput.trim()` **khác** `search` đã áp dụng
  (`if (trimmedSearch === search) return;`) — mount tick và gõ trùng giá trị
  không reset page; gõ/xóa khác giá trị vẫn debounce 350ms + reset page y
  như trước.
- `frontend/src/components/work-inbox/RoleWorkInbox.test.tsx` (giữ nguyên mọi
  assertion): thay sleep cố định 60ms bằng settle có biên
  `waitFor(Date.now() - mountedAt >= 700)` — cửa sổ quan sát luôn qua chân
  debounce 350ms nên regression lớp này FAIL deterministically, timeout vẫn
  có biên (không tăng vô hạn).

## Verify (21/10/2026)

- Repro failing-before: 6/15 run instrumented fail — trace `+435ms page=1`
  ở trên (`qa/2026-10-21-ui43-race/verdict.md`).
- Passing-after: xem `qa/2026-10-21-ui43-race/` — vitest file ×10, dir ×3,
  `npx tsgo -b`, eslint.
