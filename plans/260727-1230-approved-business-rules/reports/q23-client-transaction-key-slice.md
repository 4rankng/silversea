# Q23 client transaction-key slice

Date: 2026-07-27

## Implemented

- The shared frontend API transport now adds a UUID `Idempotency-Key` to every
  JSON mutation (`POST`, `PUT`, `PATCH`, `DELETE`) and multipart upload.
- Binary/text POST helpers use the same transaction-key rule.
- A domain client can supply a stable key for retries or offline replay; the
  shared transport preserves it instead of replacing it.
- Reads do not receive mutation keys.

## Proof

- `qa/2026-07-27_q23-client-transaction-keys_frontend-test.log`
  preserves the first red run and the corrected green rerun.
- The green rerun covers 314 frontend tests, including generated keys, key
  uniqueness, explicit replay-key preservation and read behavior.

## Remaining Q23 boundary

This closes the client-side "every submit has a transaction identifier"
precondition. It does not claim universal server replay protection. The
material-write inventory remains authoritative: each material server write
class still needs atomic replay, natural uniqueness, stale-version handling,
first-valid-approval behavior and conflict audit proof.
