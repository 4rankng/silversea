# Card 211026144400 — flaky quick-add "Nha xe" Escape settle (FB-066 lan 3) — verdict PASS

Test: `frontend/src/features/dispatch/master-plan/DispatchAllocationLclDialog.quick-add.test.tsx`
("lo CHUA co nha xe" case). Fix la TEST-ONLY — khong phai bug production.

## Root cause (runtime probe, khong suy luan)

`fireEvent.keyDown(document.activeElement, Escape)` dua voi DOM focus async cua
react-aria vao listbox: khi Escape nop ma focus con o TRIGGER button (ngoai
popover portalled ra body), event khong bubble qua popover (handler Escape nam
tren chinh popover — useOverlay keyboardProps) → popover KHONG BAO GIO dong,
`waitFor(toBeNull)` can het budget 4s. Focuskip vao option → dong dong bo ~1ms.

## Fix

- Escape ban vao option DA await ben trong popover (duong bubble y nhu ban phim
  that: option → listbox → popover). 4 cho `waitFor(toBeNull)` giu nguyen
  assertion — 0 assertion weaken.
- `{ timeout: 20_000 }` cho 4 test async (vitest default 5s/test la gioi han that
  kep cac waitFor duoi load full-suite).
- Regression case: `testplan/2026-10-21-card-211026144400-quickadd-escape-settle.md`.

## Evidence map

| File | Y nghia |
|---|---|
| `gate_vitest_quick-add_idle-baseline-r2/r5.FAIL.log` | RED-AT-BASE pre-fix: 2/5 fail idle (AssertionError popover stood) |
| `gate_vitest_quick-add_fix-idle-r1..r5.log` | post-fix idle 5/5 PASS (16:08-16:09) |
| `gate_vitest_quick-add_fix-load-r1..r5.log` | post-fix 5/5 PASS duoi 2-lane load (16:21-16:23) |
| `gates_vitest-fe-full_fix-load.TRUNCATED.log` | full-suite duoi load — BI KILL khi agent idle (~16:29), khong co summary; cac fail thay duoc deu la FILE KHAC (numeric-identity, dev-port-contract, AssignTruckGroupDialog, DIS group...), quick-add khong xuat hien trong fail list |
| `load-lane1/2.TRUNCATED.log` | 2 lane background full-run — cung bi kill, cung ghi nhan |

## Controller re-verify (salvage 980b1c49, 21/10 16:27)

- scoped vitest 3x: 5/5 pass moi run (15.8s / 15.6s / 32.4s — run 3 chay song
  song tsc + eslint = contention that).
- FE `tsc --noEmit`: exit 0. Scoped eslint: exit 0.
- Review doc lap (code-reviewer subagent cua lane): APPROVE, 6/6 constraint
  xac minh tai source react-aria@3.53.1.

## Not covered

- Full-suite xanh duoi load chua co summary hoan chinh (log bi kill) — can chung
  minh qua full-run tiep theo tren main.
