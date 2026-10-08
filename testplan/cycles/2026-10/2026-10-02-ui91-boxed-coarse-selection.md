# QA-AUDIT-UI-91 — Boxed categories on coarse and fine pointers

Filed before ignored candidate authoring. Environment: local dev only.

1. Reuse existing Tabs test categories Tất cả / disabled Không khả dụng / Đang thực hiện and the existing matchMedia response fixture. At a wide coarse pointer, boxed responsive Tabs render the existing finite Select, retaining counts and full labels. Native-shaped ArrowDown opens options; disabled choice emits no change; enabled choice emits its original stable ID; controlled rerender shows the selected category.
2. At a wide fine pointer, boxed Tabs retain the tablist and original native ArrowLeft/Right/Home/End roving focus, skip disabled cells and preserve callback IDs.
3. At a wide coarse pointer, bordered and plain variants retain tablists and their keyboard/disabled contract. Explicit presentation=select and existing rich title+metadata flattening remain unchanged.
4. Native local3width390/768/1440 coarse and fine1440: drive actual selected/disabled/options/full labels, capture PNG/DOM before unchanged owner geometry predicates. No business writes.
5. Canonical design203 replay: the1024 coarse inline date matchHeight comparator uses the actual finite Select. Preserve all203 cases, date selectors, tolerance,40px constraints and fine1440 tab comparators.

Not covered yet: candidate component execution, native geometry/paint/focus/readonly ORM, staging and business mutations.
