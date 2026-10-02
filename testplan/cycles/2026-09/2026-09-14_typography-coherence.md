# Typography coherence — PM correction

The user reports inconsistent and incoherent font sizes in the responsive screenshots. The final PM decision below supersedes both the older uniform 11px phone contract and the intermediate 13px compact / 14px default / 16px touch proposal. Earlier logs and screenshots retain their historical measurements; they do not set the current acceptance criteria. Keep space-efficient layouts while using a consistent semantic hierarchy.

- Normal content, action labels, control values/placeholders/options and dense record values: 12px.
- Labels, captions and metadata: 11px. Same role has the same size across devices.
- Section title: 14px; dialog/drawer title: 16px; page title: 18px; principal metrics: 20px.
- The PM explicitly referenced Moomoo's dense mobile UI after questioning 13/14px. Use that compact information density with clear actions/grouping informed by Grab.
- Native editable fields also use 12px. Preserve browser zoom; Safari focus zoom for small inputs is a device-specific verification item, not something to disable globally.
- Shared legacy tokens, utility-theme tokens and local styles must resolve to this scale. Preserve print/document and intentional icon/hidden-text semantics.

## Verification

1. Inspect computed typography and rendered output in representative pages from all eight roles at 390 / 768 / 1440, plus 320 and phone landscape on critical overlays.
2. Check labels versus values, table headers/primary/supporting data, sibling buttons and select/input values, page and modal headings, and KPI figures.
3. Check for clipping/overflow after unifying field and caption sizes; verify footer actions remain reachable, nested dialog focus and pagination remain functional.
4. Run typecheck, build and relevant component/style regressions. Reconcile older assertions against each semantic role: 11px remains correct for labels/captions, while values and actions use 12px on every viewport. Preserve unrelated pre-existing failures and retain historical logs unchanged.
5. Re-export the uncommitted patch and repeat clean-base application and exact-file comparisons.
