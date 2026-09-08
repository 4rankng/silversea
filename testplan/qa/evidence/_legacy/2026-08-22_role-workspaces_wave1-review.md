# Wave 1 independent review

Verdict: NEEDS_FIXES

## Findings

1. **High — Operations pre-trip work is omitted.** `work-inbox.service.ts` filters out rows without a trip, while the redesigned list removed the former exchange controls. The inbox must retain pre-trip order-exchange work and route its action to an authoritative control.
2. **High — Offline action success is aggregated incorrectly.** Driver and Operations use queue-wide `done > 0`, so an older success can make the newly submitted failed/conflicted command appear confirmed. Results must be correlated by command id.
3. **High — The first 100 rows can hide tab work.** Counts cover the full result but the UI filters a single limited page locally. Fetch must be state-scoped or fully paginated.
4. **Medium — Queued commands only drain while the matching detail page is mounted.** Add role-level online replay.
5. **Medium — Non-retryable 4xx responses are retained as network failures.** Only network and 5xx failures should retry; 409/428 remain conflicts and other 4xx become terminal failures with preserved payload.
6. **Medium — ARIA tabs lack Arrow/Home/End keyboard behavior.** Add roving focus behavior and regression coverage.

## Frozen boundary

No Wave 1 rendered changes were found in CUS `/shipments*` or Điều vận `/dispatch*`. The existing `DetailedPlanGrid.css` and matching test are pre-existing unrelated work. The two frozen-workspace test edits only make timezone expectations host-independent.

Review performed by the independent `task1_review` agent on 2026-08-22. A re-review is required after fixes.

## Final re-review

Verdict: **ACCEPTED**

No actionable High, Medium, or Low findings remain.

- Request sequencing prevents a stale tab or page response from overwriting the active inbox.
- Role-level replay attempts each persistent network failure only once per mount/connect cycle, so it cannot spin continuously.
- Offline results are correlated by command id; 4xx rejection is terminal; FIFO, conflict, and draft preservation behavior remains intact.
- Delivery attempt, portal-safe event, and driver progress publication use the same idempotent transaction.
- Customer responses remain isolated, immutable, versioned, and idempotent; accounting treats disputes as advisory.
- Cross-role E2E coverage matches the redesigned Operations and Customer surfaces.
- No Wave 1 implementation change affects frozen CUS `/shipments*` or Điều vận `/dispatch*` source or styling.

Final re-review performed read-only by the independent `task1_review` agent on 2026-08-22.
