---
phase: 1
title: Credential contract and runtime
status: completed
priority: P1
dependencies: []
effort: medium
---

# Phase 1: Credential contract and runtime

## Overview

Create the encrypted write-only credential contract and make it the runtime
authority for Resend delivery.

## Requirements

- Store `email.resend_api_key` in `app_settings` using AES-256-GCM.
- ADMIN-only GET/PUT under the already-mounted app-settings router.
- Never return plaintext. Omitted/blank key preserves; explicit clear removes it.
- Cache concurrent loads safely and invalidate without stale repopulation.
- Production missing-key attempts fail honestly; dev/test simulation remains.
- `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME` remain unchanged.

## Architecture

`AppSettingsConfigPage` → `/api/admin/app-settings/email` → email settings
service → encrypted `app_settings`. `sendEmail` resolves the service for each
attempt; a generation-guarded cache avoids repeat DB reads while allowing
instant replacement/clear.

## Related Code Files

- Create: `shared/src/schemas/email-settings.ts`
- Create: `backend/src/services/email-settings.service.ts`
- Modify: `shared/src/index.ts`
- Modify: `backend/src/routes/app-settings.ts`
- Modify: `backend/src/services/email.service.ts`
- Modify: `backend/src/config/index.ts`
- Modify/create focused backend tests under `backend/src/tests/`

## Implementation Steps

1. Define request/response schemas and stable endpoint paths.
2. Implement encrypted load/save/clear plus generation-safe invalidation.
3. Add nested ADMIN endpoints to the existing app-settings router.
4. Resolve the DB credential in send/retry behavior and remove environment use.
5. Lock key secrecy, preserve/clear semantics, hot reload, and missing-key
   behavior with focused tests.

## Success Criteria

- [x] No plaintext secret appears in an API response.
- [x] Stored value is encrypted and decrypts only in the backend.
- [x] Replacement and clear affect the next send without restart.
- [x] `RESEND_API_KEY` is no longer part of application runtime config.
- [x] Focused backend tests and typecheck pass.

## Risk Assessment

Main risks: stale cache after mutation, accidental secret echo, and production
false-positive delivery when unconfigured. Mitigate with generation guards,
response DTO tests, and explicit production failure tests.
