# Shared UI polish — 15 September 2026

Product target: compact, predictable Vietnamese operations UI on mobile, tablet and desktop. Retain the approved 12px data/control and 11px label scale, existing brand, online-only behavior and direct actions. No commits or deployment.

| Case | Reproduction / acceptance |
|---|---|
| POLISH-S01 | Navigate to a populated page and refresh/filter a long list. Animate only newly visible records, never hide existing records during refresh; bound the total entrance to 300ms, avoid nested animation targets and release temporary compositor hints. Reduced motion remains instant. |
| POLISH-S02 | Submit an invalid shared FormGroup field. The actual control exposes aria-invalid and a unique, readable error description; existing help/error associations survive. Correct the input and retain only current help. Explicit htmlFor and icon-leading custom/native fields remain correct. |
| POLISH-S03 | Filter/delete the last record on a later DataTable page. An empty result retains pagination so a user can return. This component has no active page consumers; verify through its component test, not a live-page claim. |
| POLISH-S04 | Wide active operations/finance tables contain overflow or use flat mobile rows. Page-specific behavior is verified in the operations and finance plans; do not substitute the unused DataTable for production page coverage. |
| POLISH-S05 | View empty tables and illustrated empty states at 390/834/1440. One compact neutral empty surface, no accumulated outer/inner padding or decorative nested borders; title, recovery description and real action remain visible. |

| POLISH-S06 | At 390/834px shared summary metrics use compact paired columns, with no clipped values; at 1440px retain a compact horizontal strip. Numeric values use the 14px section token. |

| POLISH-S07 | Truck edit on phone: input and select both use the 32px phone boundary and equal label-to-control gap. Textareas retain multiline height; invalid native fields retain their error border in dialogs. |

| POLISH-S08 | UI contract enforces the PM-selected30px phone control floor with low-specificity selectors,32px field token and44px dedicated actions. It must not require the retired blanket44px override. Driver informational banners retain content and alert semantics with neutral border/background rather than decorative full-height statusbars. |

Verification: focused component/behavior checks, complete frontend tests, strict build, lint, and actual Chrome interactions for named routes. Record browser coverage and untested combinations separately; no blanket every-state claim. Save logs and observations under qa/2026-09-15_production-polish.
