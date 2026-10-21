# UI43 RoleWorkInbox hydration race — verdict & evidence (card t_f21689bd)

Base: main `1f650a59`, branch `fix-ui43-workinbox-race`, 21/10/2026 ~20:2x-20:5x.
Repro liệu liệu: 6/15 run instrumented FAIL trên base buggy (flaky ~50% như controller report).

## Verdict: (b) COMPONENT defect — nhưng KHÔNG phải "fetch không scope"

Hai giả thuyết trong card được kiểm định bằng repro có instrumentation:

1. **"Component bắn fetch KHÔNG scope khi scope hydrate muộn" — DISPROVEN.**
   Trace fail không có call nào thiếu `customerId`. Scope gate hoạt động đúng:
   - `RoleWorkInbox.tsx` `load`: `if (role === 'customer' && !scopeReady) return;`
   - `endpointFor(...)` → `withCustomerScope(path, customerId)` luôn thêm
     `customerId=7` khi customerId đã resolve.
   - Render `customerId=null, scopeReady=false` không bao giờ gọi `api.get`.
2. **Defect thật (observed):** effect debounce search
   (`RoleWorkInbox.tsx`, pre-fix `useEffect(..., [searchInput])`) lên lịch
   `setSearch(...) + setPage(1)` **vô điều kiện** ngay từ mount → tick +350ms
   phá page URL-restored `?page=2` → refetch `page=1`. Đây đúng defect class
   UI43 (clobber queue/page), đi qua đường search debounce thay vì scope.
3. **Test-race là thứ yếu nhưng có thật:** sleep cố định 60ms + waitFor ≥2 cho
   cửa sổ quan sát ~116-370ms, mốc clobber ~350-435ms → đôi khi trước
   (green), đôi khi sau (red) → flaky ~50%. Test FAIL thành chính xác vì
   component sai; window cần mở rộng để bắt deterministically.

## Evidence — failing-before (buggy base `1f650a59`)

Instrumented repro (t0 = mount; trace ghi ra file vì vitest v4 chỉ show
console của test FAIL):

```
elapsed=+447ms calls=3
  +43ms  /portal/work-inbox?view=WAITING&page=2&limit=100&customerId=7
  +309ms /portal/work-inbox?view=WAITING&page=2&limit=100&customerId=7
  +435ms /portal/work-inbox?view=WAITING&page=1&limit=100&customerId=7   ← clobber (350ms tick + latency)
AssertionError: expected false to be true (RoleWorkInbox.test.tsx assertion every(page=2))
```

Mutation check (guard proof, buggy base `git show 1f650a59:...` nạp vào working tree):

```
real_test_mutation_exit=1
 FAIL ... > preserves restored queue and page through first asynchronous customer scope hydration (UI43)
 AssertionError: expected false to be true
 Tests  1 failed | 21 skipped (22)
```

→ Test đã giữ (với settle có biên 700ms) FAIL deterministically trên base
buggy. Ngược lại, repro với window hẹp cũ (sleep 60ms) PASS ở cùng code buggy
khi window kết thúc ở +116ms < 350ms — chứng minh cơ chế flake.

## Evidence — passing-after (fix trong cây)

Trace sau fix (cùng instrumented repro):

```
elapsed=+141ms calls=2
  +31ms /portal/work-inbox?view=WAITING&page=2&limit=100&customerId=7
  +71ms /portal/work-inbox?view=WAITING&page=2&limit=100&customerId=7
```

Không còn tick +350ms → không có call thứ 3, không có `page=1`.

## Fix

1. `frontend/src/components/work-inbox/RoleWorkInbox.tsx` — debounce effect
   chỉ schedule page-reset khi giá trị search **thực sự đổi**
   (`if (trimmedSearch === search) return;`, deps `[trimmedSearch, search]`).
   Gõ/xóa khác giá trị → debounce 350ms + `setPage(1)` y như cũ (pin bằng
   test "searches the OPS queue server-side: debounced, page reset...").
2. `frontend/src/components/work-inbox/RoleWorkInbox.test.tsx` — GIỮ nguyên
   mọi assertion của test UI43; thay sleep 60ms bằng settle có biên
   `waitFor(() => expect(Date.now() - mountedAt).toBeGreaterThanOrEqual(700))`
   — cửa sổ luôn qua chân debounce 350ms (250ms+ slack so với latency quan
   sát +85ms), timeout waitFor default 1000ms > max cần (650ms) → có biên,
   không tăng vô hạn.
3. Regression case: `testplan/cases/case-QA-2026-10-21-ui43-workinbox-debounce-page-clobber.md`.

## Gates (tránh full-FE suite theo lane constraint)

|Gate|Log|Kết quả|
|---|---|---|
|vitest file UI43 ×10|`2026-10-21_ui43_vitest-file-x10.log`|**10/10 PASS**, mỗi run 22/22|
|vitest `src/components/work-inbox/` ×3|`2026-10-21_ui43_vitest-dir-x3.log`|**3/3 PASS**, mỗi run 24/24 (2 files)|
|`npx tsgo -b`|`2026-10-21_ui43_tsgo-b.log`|exit 0, 0 error|
|`pnpm exec eslint` (2 file đụng)|`2026-10-21_ui43_eslint-touched.log`|exit 0|
|`pnpm lint` (frontend-wide)|`2026-10-21_ui43_eslint-frontend-wide.log`|exit 0|
|Mutation check (buggy base `1f650a59`)|`2026-10-21_ui43_mutation-buggy-base.log`|test UI43 FAIL (guard bắt regression) — failing-before artifact|
|Independent review (code-reviewer)|`agent://UI43RaceReview`|APPROVE (kèm `npx tsc -b` exit 0, 22/22, defect-class sweep)|

Full FE suite (5415) do orchestrator wave-close theo lane constraint.

## Coverage (§9 rung, trung thực)

|Claim|Rung|Evidence|Not covered|
|---|---|---|---|
|Tick debounce không còn phá page restored; test UI43 green 10/10|Unit-automated (không phải UI DRIVEN)|logs trong thư mục này|Không drive browser thật (dev server + auth thuộc lane scope khác; env đang bị lane khác chiếm)|
|Search OPS debounce + page reset giữ nguyên|Unit-automated (test hiện có pass trong 24/24)|dir-x3 log|cùng như trên|
|Scope gate không bắn fetch không scope|Unit-automated + repro trace|trace phía trên|—|

## Ghi chú history

Branch có 2 commit `salvage(guard)` (auto-commit anti-mất-code của paseo khi
agent idle chạy background job): `0a466162` (rác scratch repro — đã `git rm`
trong commit fix), `79a58092` (component fix). Giữ nguyên theo append-only
rule (không reset/amend/rebase).
