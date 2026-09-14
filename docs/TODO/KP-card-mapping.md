# KP ↔ kanban card mapping (2026-09-14 sync)

Source: `20260914_KANBAN_PROD_Implementation_Plan.md` (191 KP items, 27 WPs).
Method: normalized-title fuzzy match against all four board columns + lead
curation of the unmatched set.

- **130/191 auto-matched** to existing cards (same topic, card id may differ
  from KP id — KP numbering is the audit's own).
- **~50 of the 61 unmatched are covered under different phrasings**, notably:
  KP-001=`_17`, KP-135=`_18`, KP-064=`_15`, KP-065=`_16`, KP-067=`_3`,
  KP-002=QA-143 (P0, in flight), KP-136=QA-144, KP-137/KP-014=QA-145,
  KP-138=QA-146, KP-139=QA-147, KP-004=QA-060 (rework landed d3ed8482+2f2e4433,
  staging verify pending), KP-072=QA-060 family, KP-062=`_14`, KP-066=`_2`,
  KP-060=`_12`, KP-084=QA-040, KP-102=QA-068, KP-130=QA-062, KP-116=QA-093,
  KP-131=QA-135, KP-164=QA-141, KP-163=QA-138, KP-162=QA-137,
  KP-140=P1_5 (CẦN THÔNG TIN), KP-191=P0_Mobile (Lai xe role), plus the
  old 20260911-13 driver/carrier/dispatch card families now in QA_PASSED
  (audit re-verify flavor).
- **11 genuinely uncarded → new cards `_19`…`_29`:**
  _19=KP-018, _20=KP-019, _21=KP-021, _22=KP-022, _23=KP-023(+057),
  _24=KP-026, _25=KP-133, _26=KP-123, _27=KP-134, _28=KP-058, _29=KP-024.
- **Release completion checklist** (plan's final section) is the closure gate
  for the whole batch — verify-type KPs (019/021/024/026, 134) feed it; it
  runs after the TODO column drains.
