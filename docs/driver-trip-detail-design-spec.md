# Driver trip detail — design spec (`/my-trips/:id`)

Binding spec for the driver trip-detail screen. Source ticket: Kanban
`20260912_6` ("Thống nhất thiết kế + cỡ chữ màn hình chi tiết chuyến") plus the
collapsible-section requirement from `20260911_2` BUG 1. Implemented by the
09-12 style wave (`8daf4cfb` type scale, `228e47e4` photo slots, `fe7c6dba`
banner rhythm + spacing, collapsible heads). This document is the contract any
future change to the screen must keep.

Functional behavior is out of scope for design changes — spacing, type and
hierarchy only.

## Type roles (the only allowed sizes on this screen)

| Role | Spec | Used for | CSS anchors |
|---|---|---|---|
| Display (screen title) | 24/700 → 20 @≤768 → 18 @≤480, `--ink` | `DriverTripHeader` title only | `.driver-task-header__title` |
| Section title | 13/700, sentence case, `--ink-2` | every section head ("Thông tin lệnh", "Tác vụ", "Quy định tại điểm làm hàng", …) | `.driver-task-section__head` |
| Label | 11/700, uppercase, +0.08em tracking, `--ink-3` | fact-grid labels ("Nhà máy", "Cảng nâng"…) | `.driver-task-fact__label` |
| Body | 14/400 lh 1.45, `--ink` | fact values, list content | `.driver-task-fact__value` |
| Aux / caption | 12–13/400–600, `--ink-3` | summaries, footer notes, chips | `.driver-task-footer__summary p`, `.driver-task-close-chip` |

No italic "old-style" captions. Two sanctioned emphasis exceptions inside the
content area, both deliberate display treatments (never plain body text):
the milestone step title at 16/600, and the seal evidence value at
15/700 uppercase +0.04em (`.dcc-bento__seal-value`, plate-adjacent — the
plate itself is the 20/800 display tier).

## Section blocks

- One elevation per group: a section is one `--surface` card, 16px padding,
  1px `--line` border, 18px radius, 12px vertical rhythm between sections
  (`.driver-task-section`). No nested cards inside a section (the 08-28
  flatten rule still applies).
- Collapsible heads (`Thông tin lệnh`, `Thông tin xuất hóa đơn`): the whole
  head row is the toggle button (`.driver-task-section__toggle`,
  `aria-expanded` + `aria-controls`; ≥44px touch on `pointer: coarse`).
  Collapsed, the head keeps a one-fact summary — factory short name — so the
  driver still recognizes the trip. Both sections start expanded.
- Banner-family sections (site rules / sync / bypass notices) use the
  brand-rail treatment: brand 8% tint surface, 3px brand left rail, body
  capped at 13px so notice text never outweighs section titles
  (`.driver-task-section--banner`).

## Photo block (single group)

All trip photos live in ONE card (`DriverContainerCard`): container / seal /
biên bản giao hàng slots at equal size and style; the delivery-note block
mounts inside the same card, never as a separate big-button section. Upload /
retake affordances are ghost-style, one size.

## Buttons

Two tiers only: primary (filled, brand/accent) and secondary/ghost. Touch
targets ≥44px on `pointer: coarse`. The sticky accept bar and the footer CTA
are the only primary buttons on the screen.

## Verification

- Frontend suite pins the behavior: `DriverTripDetailPage.test.tsx`
  (TC-COMP-004 / TC-COMP-004b collapse, TC-DA-001…006 content contracts).
- Visual evidence: `qa/2026-09-12_driver-detail-design/` (expanded vs
  collapsed, photo block, type roles).
