---
title: Shipment create page containment lessons
date: 2026-08-14 22:24
type: technical-journal
---

# Shipment create page containment lessons

## Context

Shipment creation was consolidated onto the canonical `/shipments/new` page. The embedded create modal and legacy route were replaced so the workflow has one authoritative entry point.

## What happened

The create form exposed two boundary issues. First, native `<select>` controls can size their intrinsic option content wider than the grid track. Inside a `minmax` layout this allowed long options to force hidden horizontal overflow. Constraining the control with `width: 100%`, `min-width: 0`, and `max-width: 100%` kept the control inside its track while preserving the native picker.

Second, trade direction was validated as required by the frontend form, but that alone was not an API invariant. The backend dispatch boundary must validate the field as well, so direct or stale clients cannot submit a dispatch without a valid trade direction.

## Reflection

Canonical routing reduces competing UI contracts, but it does not remove the need to test browser-native sizing behavior or enforce business requirements at the server boundary. Form-level validation and layout containment are separate concerns and both need explicit checks.

## Decisions

- Keep `/shipments/new` as the single create entry point; remove reliance on the embedded modal and legacy route.
- Treat native controls as intrinsically sized content and constrain them at the grid-item boundary.
- Enforce required trade direction at the backend dispatch boundary, in addition to frontend validation.

## Next

For future create-flow changes, verify canonical navigation, realistic long-option widths at desktop and narrow viewports, and direct API submissions that bypass the frontend. Keep the frontend and backend requirements documented as one business invariant.
