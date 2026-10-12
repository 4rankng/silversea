# Regression spec — FB-007 round 16: factory picker options must show the phone

**Ticket:** FB-007 (round 16 verify-fail, half-fixed) — card 121026185520; prior card 111026175000
**Owner (implement):** frontend
**Owner (verify):** qa
**Status (this doc):** covered by unit pins + local UI rung
**Cycle:** 2026-10 round 16

## Goal

Card 111026175000 put the factory contact phone into the detail popover
(round-16 PASS) and into the picker's search text, but kept the option label
name-only. The owner requires the phone VISIBLE in each dropdown option, from
the same source (operational_sites.contact_phone) — no new fields.

## Acceptance criteria

### TC-FB007R16-001 — Option shows the phone

- **Given** a factory with contact_phone on file
- **When** the create-grid "Nhà máy" menu opens
- **Then** the option renders the phone as a secondary line beside the name.

### TC-FB007R16-002 — Phone-less factories render no stray line

- **Given** a factory without contact_phone
- **Then** the option shows only the name — never "undefined"/"null".

### TC-FB007R16-003 — Density contract intact

- The committed label and the collapsed cell keep the name only (card
  20260923_2 — no address/phone bloat in the row cell).

### TC-FB007R16-004 — Search by phone still works

- Typing the number still filters to the factory (prior card's searchText).

### TC-FB007R16-005 — 390px option rows do not clip

- Two-line options wrap within the dropdown at 390px width.

## Out of scope

- The detail popover (already passing); other pickers; backend; new fields.
