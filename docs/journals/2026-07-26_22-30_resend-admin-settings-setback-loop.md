# Resend admin settings: secret redaction, retry state, and shared QA

**Date**: 2026-07-26 22:30
**Severity**: High
**Component**: Admin-managed Resend API key flow
**Status**: Resolved locally, not deployed

## What Happened

The API response and browser remained write-only, but the independent review
found a separate plaintext path: the global mutation audit middleware would
have persisted `resendApiKey` from the request body. The fix now strips both
camel-case and snake-case Resend credential fields before writing audit data,
with a focused regression test.

The review also found two runtime defects. Explicit clear first tried to read
and decrypt the existing row, which meant an administrator could not recover
from corrupt ciphertext or a rotated master key. The clear path now deletes
the row directly. Separately, `retryEmail()` could return an error while the
log row stayed `PENDING` with `errorMessage` cleared, so a failed retry looked
like an in-flight message instead of a failed one. All terminal retry errors
now restore `FAILED` with a concrete message.

The other complication was shared-worktree QA. The focused Resend tests passed,
and a later clean full backend rerun completed with 1,413 passing tests. The
full browser E2E gate still stops on an unrelated ADMIN unknown-route redirect
owned by concurrent routing work. The targeted authenticated Resend API flow
passes, including ADMIN access, non-ADMIN rejection, encrypted persistence,
audit redaction, and clear.

## The Brutal Truth

The uncomfortable part was that a masked response was not enough to prove
secret safety. The value could still leak into an internal audit trail after
the response contract had done the right thing. The retry bug was similarly
easy to miss because the function returned an honest error while leaving a
dishonest persisted state.

## Technical Details

- The API and browser never returned the plaintext key, but the audit body
  needed explicit redaction before persistence.
- Explicit clear now bypasses decryption and physically deletes the setting
  row, allowing recovery from invalid ciphertext.
- The retry path issue reproduced as: `ok: false`, `error: "Retry requires template body (not yet implemented)"`, while the row still read `status: "PENDING"` and `errorMessage: null`.
- Focused backend email tests passed, and the final full backend suite passed
  1,413 tests.
- Full E2E remains red on an unrelated ADMIN unknown-route redirect; the
  earlier Forwarder finance redirect now passes.

## What We Tried

- Checked the API response, frontend state, and persisted audit body separately.
  The first two were safe; the audit body was not until redaction was added.
- Added corrupt-ciphertext recovery coverage for explicit clear.
- Reproduced the retry path against the database instead of guessing. That exposed the `PENDING` status bug.
- Ran focused tests first, then broader QA to separate feature regressions from unrelated suite problems.

## Root Cause Analysis

There were three root causes: generic audit sanitization did not know the new
credential field; clear reused a read-before-write path even though deletion
does not require plaintext; and retry mutated the row to `PENDING` without
restoring a terminal state on every failure branch. The remaining E2E failure
is separate concurrent routing behavior.

## Lessons Learned

- Secret safety must be checked across response, UI, logs, audit records, and
  storage—not only the API DTO.
- A destructive credential clear should not depend on decrypting the value it
  is meant to remove.
- If a retry path can fail after a state write, every terminal error must leave the row in a terminal state.
- Unrelated QA hangs are still real, but they should not be allowed to blur the feature-specific failure signal.

## Next Steps

Before deployment, an administrator must save the production Resend key in
Settings because the environment variable is intentionally no longer a runtime
fallback. Landing also remains gated on the concurrent unknown-route E2E
failure being resolved or isolated. The audit, corrupt-clear, and retry
regressions are covered by focused tests.
