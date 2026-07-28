# Shipment Phone Bottom Fold Repair

**Date**: 2026-07-28 23:48
**Severity**: Medium
**Component**: Shipments page, mobile layout
**Status**: Resolved

## Context

The shipment list looked fine on desktop, but the phone viewport had a subtle
yet disruptive issue: the breadcrumb stayed visible, inherited the shared 44px
touch-target floor, and consumed enough vertical space to push the list footer
below the initial fold.

## What Happened

At 390 × 844 mobile emulation, the breadcrumb sat in the page stack above the
cards, the internal `.app-body` scroller needed 67px of extra travel, and the
footer landed 30.171875px below the visible viewport. The page still worked,
but the first screen looked unfinished and forced users to scroll for content
that should have been visible immediately.

## Root Cause

The breadcrumb was treated like normal page chrome instead of a redundant phone
element. That kept the shared safe-area and touch-target contract intact, but it
also meant the breadcrumb kept its full height on the smallest screens. The
problem was not the footer itself; it was the breadcrumb occupying space that
mobile did not need.

## Decision

The shared breadcrumb sizing, spacing, and touch rules remain unchanged because
altering them would affect other pages and risk the accessibility contract. The
fix is narrower: hide
`.shipments-page__crumbs` only at `max-width: 640px`, and leave tablet/desktop
unchanged.

## Verification

Manual QA on the staging DOM passed at the phone viewport. Before the change,
the footer sat below the fold; after the change, `.app-body` height collapsed to
match the viewport, the breadcrumb computed to `display: none`, horizontal
overflow stayed at `0px`, and the final card plus footer were visible on first
load. The regression test in `frontend/src/pages/ShipmentsPage.test.tsx`
captures the phone-breadcrumb rule so this does not quietly come back.

## Next

Keep the phone-only breadcrumb override in place and do not generalize it into a
shared layout tweak. If another page hits the same symptom, fix that page
locally instead of eroding the common touch and safe-area rules.
