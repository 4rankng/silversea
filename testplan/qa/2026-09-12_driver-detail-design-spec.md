# Regression spec — 20260912_6 driver trip-detail design consistency

**Source:** `/Users/dev/My Drive/SilverSea/Kanban/TODO/20260912_6.docx`
**Binding spec:** `docs/driver-trip-detail-design-spec.md`
**Date:** 2026-09-12
**Status:** DONE — implementation verified live + unit-pinned

## Goal

The driver trip-detail screen (`/my-trips/:id`) had mixed type sizes, two
duplicate photo areas, mixed button scales, and uneven spacing. The 09-12
style wave (`8daf4cfb` type scale, `228e47e4` photo slots, `fe7c6dba` banner
rhythm) implemented the fix; this card's remaining deliverable was the
detailed design spec, now `docs/driver-trip-detail-design-spec.md`.

## Regression TCs

### TC-DES-001 — One type system whole screen

- **Given** the driver opens `/my-trips/:id` (390×844)
- **When** computed font sizes are sampled across `main`
- **Then** only spec tiers appear: 14 body · 13 section-title/aux ·
  12 caption · 11 label · 20-24 screen-title tier, plus the two sanctioned
  emphasis exceptions (16 step title, 15 seal evidence value). No italic
  captions, no stray sizes.
- **Evidence:** `qa/2026-09-12_driver-detail-design/ui-driver.log` step 8
  (census: 14×147, 13×30, 12×23, 11×41, 20×2, 15×1)

### TC-DES-002 — Photo areas are ONE block

- **Given** the trip detail renders
- **When** the container card renders
- **Then** container / seal / biên bản giao hàng photo slots share one card
  (`DriverContainerCard`), same 96×96 slot paradigm; no separate
  big-button delivery-note section exists
- **Evidence:** `qa/2026-09-12_driver-detail-design/design-photo-block.png`;
  `DriverContainerCard.tsx` mounts `DriverDeliveryNoteCard` internally

### TC-DES-003 — Collapsible section heads (with 20260911_2 BUG 1)

- **Given** the task-info sections render expanded
- **When** the driver taps a section head
- **Then** that section collapses (head keeps the factory short-name
  summary), the other section is untouched, and tapping again restores;
  head is ≥44px touch on coarse pointers
- **Evidence:** unit `DriverTripDetailPage.test.tsx` TC-COMP-004/004b; live
  `qa/2026-09-12_driver-detail-design/comp-004a-collapsed.png` +
  `comp-004b-expanded.png`

## QA gates (2026-09-12 run)

`qa/2026-09-12_driver-detail-design/gates.log` — lint 0 errors · backend tsc 0 ·
frontend tsc 0 · frontend vitest 264 files / 1622 pass · make build green.

## Not covered

- Tablet/desktop viewport for the type census (mobile 390 only — driver app is
  mobile-first)
- Real-photo upload flow (functional surface, unchanged by design work)
