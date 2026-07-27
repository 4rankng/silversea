---
phase: 2
title: Admin settings UI
status: completed
priority: P2
dependencies:
  - 1
effort: small
---

# Phase 2: Admin settings UI

## Overview

Add a flat, responsive “Gửi email qua Resend” panel using the page’s existing
secret-field, mutation, and confirmation patterns.

## Requirements

- Show configured status and masked suffix without ever loading plaintext.
- Support replace and explicit confirmed clear actions.
- Announce success/error states and disable controls during mutations.
- Preserve mobile wrapping, 44px actions, and no horizontal overflow.

## Related Code Files

- Modify: `frontend/src/api/appSettingsClient.ts`
- Modify: `frontend/src/hooks/useAppSettings.ts`
- Modify: `frontend/src/pages/config/AppSettingsConfigPage.tsx`
- Modify: `frontend/src/pages/config/config-page.css`
- Create: `frontend/src/pages/config/AppSettingsConfigPage.test.tsx`

## Implementation Steps

1. Add typed client methods and TanStack Query hooks.
2. Add panel, write-only field, configured indicator, save feedback, and clear
   confirmation using `useConfirm`.
3. Add minimal single-column/action responsive styles.
4. Test rendering, replacement, clear, and secret non-disclosure behavior.

## Success Criteria

- [x] ADMIN can save, replace, and clear the credential.
- [x] Stored plaintext is never rendered or fetched.
- [x] Keyboard, status/error semantics, and pending states are correct.
- [x] Desktop and narrow mobile layouts have no overflow.

## Risk Assessment

Avoid coupling the secret update to feature-toggle saves and avoid clearing on a
blank field. Reuse existing controls rather than introducing a new modal system.
