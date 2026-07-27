# Resend admin settings debug audit

## Executive Summary
- Scope: ADMIN-managed Resend credential path in current dirty worktree only. Read-only audit; no code edits.
- Findings: 2 confirmed.
- High: `retryEmail()` returns an error but leaves the DB row `PENDING`, clearing `errorMessage`; this breaks retry/ops status integrity.
- High, conditional rollout blocker: code removed `RESEND_API_KEY` as a runtime source with no migration/bootstrap path into `app_settings`. If production still relies on env-only config, post-deploy email sends deterministically fail until an ADMIN saves the key in the UI.
- Clean areas: no plaintext browser exposure found; blank-preserve and explicit-clear runtime semantics work; new writes are encrypted; ADMIN RBAC/route ordering is correct; focused backend/frontend tests pass.

## Timeline
- 22:04 read `AGENTS.md`, `CONTEXT.md`, `HANDOFF.md`, current plan, current diff.
- 22:10 ran frontend test command; suite passed (`54 files`, `286 tests`).
- 22:10 ran focused backend email tests; pass (`10 tests`, `0 fail`).
- 22:11 reproduced retry-path status bug with a throwaway DB script and cleanup.

## Hypotheses Tested
1. Plaintext secret may be exposed to the browser.
   - Eliminated.
   - Evidence: backend response DTO returns only `resendKeySet` + masked suffix in [backend/src/routes/app-settings.ts](../../../backend/src/routes/app-settings.ts:17) and frontend uses an empty local password field plus masked placeholder in [frontend/src/pages/config/AppSettingsConfigPage.tsx](../../../frontend/src/pages/config/AppSettingsConfigPage.tsx:405). Frontend tests assert password type and no stored plaintext render in [frontend/src/pages/config/AppSettingsConfigPage.test.tsx](../../../frontend/src/pages/config/AppSettingsConfigPage.test.tsx:110).
2. Cache invalidation may repopulate a stale key after save/clear.
   - Eliminated for the audited path.
   - Evidence: `cacheGeneration` guards in-flight loads and save resets `loadPromise` + `cached` only after DB write in [backend/src/services/email-settings.service.ts](../../../backend/src/services/email-settings.service.ts:30).
3. Retry status accounting may be wrong.
   - Confirmed.
   - Evidence: code path plus live reproduction below.
4. Existing env-only deployments may continue working after this change.
   - Eliminated; confirmed conditional rollout risk instead.
   - Evidence: runtime config no longer reads `RESEND_API_KEY` in [backend/src/config/index.ts](../../../backend/src/config/index.ts:143) and `getEmailSettings()` reads DB only in [backend/src/services/email-settings.service.ts](../../../backend/src/services/email-settings.service.ts:17). Backend test explicitly asserts "starts unconfigured without an environment fallback" in [backend/src/tests/email-settings.test.ts](../../../backend/src/tests/email-settings.test.ts:44).

## Findings

### 1. High — configured-key retry leaves email logs stuck `PENDING`
- Evidence chain:
  - `retryEmail()` sets the row to `PENDING`, increments `retryCount`, clears `errorMessage` in [backend/src/services/email.service.ts](../../../backend/src/services/email.service.ts:122).
  - When a Resend key exists, the function then returns `ok: false` at the template-placeholder branch without restoring `FAILED` or writing an error in [backend/src/services/email.service.ts](../../../backend/src/services/email.service.ts:147).
  - Live reproduction:
    ```json
    {
      "result": {
        "ok": false,
        "logId": 381,
        "error": "Retry requires template body (not yet implemented)"
      },
      "after": {
        "status": "PENDING",
        "retryCount": 1,
        "errorMessage": null
      }
    }
    ```
- Impact:
  - Ops and any scheduler logic keyed on `FAILED` rows can lose visibility of a real failure.
  - The row looks in-flight even though the function already returned a terminal error.
  - `errorMessage` is erased, so the previous reason is lost.
- Why tests missed it:
  - [backend/src/tests/email-service.test.ts](../../../backend/src/tests/email-service.test.ts:112) covers retry on `SENT`, max retries, and missing log only. No test covers a `FAILED` retry with a configured key.

### 2. High, conditional rollout blocker — env-only production setups will lose outbound mail on deploy
- Evidence chain:
  - `config` keeps only `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME`; `RESEND_API_KEY` was removed from runtime config in [backend/src/config/index.ts](../../../backend/src/config/index.ts:143).
  - `getEmailSettings()` loads only `app_settings.email.resend_api_key` in [backend/src/services/email-settings.service.ts](../../../backend/src/services/email-settings.service.ts:17).
  - `sendEmail()` now fails in production when that DB value is empty in [backend/src/services/email.service.ts](../../../backend/src/services/email.service.ts:58).
  - Focused test locks this behavior in: [backend/src/tests/email-settings.test.ts](../../../backend/src/tests/email-settings.test.ts:44).
- Impact:
  - If the deployed environment currently sends mail via `RESEND_API_KEY` only and no ADMIN has saved the DB credential yet, the next production send becomes `FAILED` with `Resend API key chưa được cấu hình`.
  - This is not a speculative code smell; it is the deterministic post-deploy behavior under that precondition.
- Scope note:
  - I did not inspect live production state, so I cannot say whether production currently has the DB row. I can say the code provides no migration/bootstrap path.

## Clean / Ruled-Out Areas
- DB encryption for new writes is present: `encryptSecret()` on save and masked-only response DTOs in [backend/src/services/email-settings.service.ts](../../../backend/src/services/email-settings.service.ts:64) and [backend/src/services/crypto.ts](../../../backend/src/services/crypto.ts:66).
- Blank-preserve vs explicit-clear runtime semantics are correct and tested in [shared/src/schemas/email-settings.ts](../../../shared/src/schemas/email-settings.ts:10) and [backend/src/tests/email-settings.test.ts](../../../backend/src/tests/email-settings.test.ts:62).
- ADMIN-only routing is enforced in backend and frontend:
  - [backend/src/index.ts](../../../backend/src/index.ts:157)
  - [frontend/src/App.tsx](../../../frontend/src/App.tsx:202)
- Focused verification:
  - `cd backend && npx tsx --test src/tests/email-settings.test.ts src/tests/email-service.test.ts` → pass, `10 tests`, `0 fail`.
  - `cd frontend && pnpm test -- src/pages/config/AppSettingsConfigPage.test.tsx` → pass, suite output `54 files`, `286 tests`.

## Recommendations
### Immediate
- Fix `retryEmail()` so every terminal error path writes `FAILED` plus a concrete `errorMessage` before returning.
- Add a regression test for `FAILED` + configured-key retry that proves the row ends `FAILED`, not `PENDING`.

### Before deploy
- Treat rollout as blocked until one of these is true:
  - a pre-deploy migration/bootstrap copies the existing Resend key into `app_settings`, or
  - production is verified to already have `email.resend_api_key` populated via the ADMIN UI.
- Add a deployment/runbook step that checks `app_settings.key = 'email.resend_api_key'` before release.

### Short-term
- Add an API/route test proving `/api/admin/app-settings/email` never returns plaintext and rejects non-ADMIN callers.
- Decide whether explicit clear should delete the row entirely or keep the current empty-string row; current callers work, but the implementation does not physically remove the row.

## Unresolved Questions
- Does production already have `app_settings.email.resend_api_key` populated, or is it still env-only?
- Should explicit clear delete the DB row for audit/reporting consistency, or is empty-string persistence intentional?

Status: DONE_WITH_CONCERNS
Summary: Confirmed two material risks: retry-path status corruption and an env-to-DB rollout blocker. Plaintext exposure, runtime clear/preserve semantics, encryption on new writes, and ADMIN gating audited clean.
Concerns/Blockers: Deploying before production credential cutover is verified can break outbound email; retry-path bug needs a code fix before trusting email log states.
