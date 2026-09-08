Deploy: make demo (from clean tree at f95cc62a)
Date: 2026-08-27 10:09 +08
Target: https://vantai.tingting.vip
Pushed: 70778152..f95cc62a (f95cc62a quick-issue feature + bd4d1d97 auth teardown fix)
Exit status: 0 — verified by served-artifact content, not exit code.

Backend: /api/health → {"status":"ok","timestamp":"2026-08-27T02:09:14.209Z"}
Migrations: none pending (42P07 notice only — __drizzle_migrations exists).

Artifact-vs-commit verification:
- Served CSS: assets/DispatchDetailPlanPage-BA13XUHs.css — filename hash IDENTICAL to
  local `pnpm build` of f95cc62a (vite content-hash ⇒ byte-identical source CSS).
  Contains .dispatch-assignment-cell__quick-issue (base + mobile rules).
- Served JS: assets/DispatchDetailPlanPage-DxLuHJKt.js contains both
  "Phát lệnh nhanh · ${…}" (aria-label) and
  "Phát lệnh nhanh — không cần mở ô điều phối" (title).
  JS hash differs from local build as expected — Docker build bakes staging API URL.
- Served entry index.html → assets/index-BxjAdQhA.js (quick-issue code is in the lazy
  route chunk, not the entry — marker correctly absent from entry).

Conclusion: staging is serving f95cc62a. Deploy verified.
