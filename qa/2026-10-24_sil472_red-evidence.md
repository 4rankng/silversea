# SIL-472 — RED evidence: new regression tests on PRE-FIX trunk code

Procedure: component fix temporarily reverted (`git checkout -- CusContainerLedger.tsx`,
fix preserved at /tmp/sil472-fixed-component.tsx), test file kept at final text, then:

$ cd frontend && pnpm exec vitest run src/features/shipments/cus/CusContainerLedger.test.tsx

 ❯ src/features/shipments/cus/CusContainerLedger.test.tsx (48 tests | 3 failed) 6184ms
     × runs the gỡ-tờ-khai step, then deletes with the fresh version — dialog closes, host refetches 1038ms
     × a refused gỡ keeps the dialog open, never fires the delete, and surfaces the server reason 1043ms
     × the confirm dialog names the tờ khai before the operator confirms 1022ms
 Test Files  1 failed (1)
      Tests  3 failed | 45 passed (48)

(The 4th new test — undeclared row deletes directly — passes pre-fix by design:
it pins the unchanged no-tờ-khai path.)

Fix restored → same suite: 48 passed (48), EXIT=0 (see gates-vitest-ledger.log).
The failing assertions are the missing data-flow: zero `updateCusShipmentContainerLine`
gỡ calls, `onLineSaved` never called with null, dialog message never names the tờ khai.
