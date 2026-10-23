# Icon sweep (owner no-exception directive 23/10)
Inline <svg> icons -> lucide-react in 13 files. Remaining `<svg` (allowed, not icons):
- components/charts/*, design-system/Sparkline.tsx, components/untitled-ui/** (chart geometry / vendored foundations)
- pages/FinancePage.tsx: donut + bar chart (role="img" data charts); its export icon was swapped.
Regression: frontend/src/tests/icon-sweep-no-inline-svg.test.ts
Gates: tsc -b 0; full FE vitest 5557 tests, 2 failures in numeric-identity.styles.test.ts needed a built bundle -> passed 6/6 after `pnpm build` (exit 0); screenshots dashboard-1440-{before,after}.png.
UI rung: 1440 Dashboard rendered (admin, local) = screenshot only; no DOM/DB side-effect proof, other widths/pages not driven.
