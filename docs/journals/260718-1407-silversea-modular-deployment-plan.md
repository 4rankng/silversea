---
date: 2026-07-18
session: silversea-modular-deployment
status: resolved-no-code-changes
---

# SilverSea Modular Deployment Decisions

## Context

The SilverSea work stayed in planning only. The roadmap already set the core boundary: one shared codebase, immutable backend/frontend images, and physically isolated per-customer deployments with separate VPS, PostgreSQL, Redis, storage, secrets, and backups. See [ROADMAP.md](/Users/dev/Documents/projects/nepocorp/ROADMAP.md) for the deployment model that this session narrowed rather than changed.

## What Happened

We stopped treating every SilverSea difference like a configuration problem. The accepted boundary is that only genuine incompatibilities get settings, while shared modules stay shared. Tire management is shared, not customer-specific. Chatbot provider selection stays in Admin settings and supports MiniMax or OpenRouter. OCR uses the stored OpenRouter key when available and falls back to manual entry when the key is missing or unusable. Bách Khoa GPS remains an encrypted NEPO-only integration, not a generic customer toggle. No application code was implemented in this session.

## Reflection

The useful part of this session was rejecting scope creep before it turned into fake flexibility. The bad pattern here is obvious: if we expose every preference as a switch, we inherit config drift, untestable combinations, and a settings page that pretends to be architecture.

## Decisions

- Shared codebase stays shared; deployments stay physically isolated per customer.
- Settings only cover real incompatibilities, not ordinary catalog or operating differences.
- Tires remain shared behavior across installations.
- Chatbot provider choice is configurable in Admin settings between MiniMax and OpenRouter.
- OCR uses OpenRouter only through the stored key path, with manual entry as fallback.
- Bách Khoa GPS stays encrypted and NEPO-only.
- No code changes were made here; this was a planning decision session only.

## Next

Turn the boundary into the requirement matrix and settings-page spec, then implement only the validated switches. The next owner should be the planning track, not a code branch, until the incompatible-vs-shared line is locked down.
