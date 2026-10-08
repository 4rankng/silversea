# Reported schedule persistence and agent-contract follow-up

## QA-SESSION-SCHEDULE-01 — saved return time is immediately authoritative

On a READY row in `/dispatch-detail`, open Chỉnh sửa điều phối. Change Giờ trả
hàng from 09:00 to 13:00, save and immediately reopen before the background
refresh returns. The dialog must show 13:00 from the returned persisted
plannedEndAt. A clear must show empty immediately. An older pending refresh
must not restore 09:00. A subsequent successful fresh read must agree.
The CUS-owned container appointment remains the separate departure schedule
shown under Thời gian & lịch trình; editing Giờ trả hàng does not overwrite it.
Repeat after request failure: retain the original row and editable draft/error.
Current case targets the reported stale-time defect class without inventing
an unapproved departure override or mutating an issued trip.

## QA-SESSION-AGENTDOC-01 — concise, effective runtime contract

Read AGENTS.md and CLAUDE.md in a fresh task. There must be one canonical
contract with no duplicate runtime rules. Preserve current authority order,
local-only/prod prohibition, trunk/append-only/remotes limits, regression first,
independent review, affected gates and evidence/artifact requirements. Include
owner decisions: 40px control ceiling, compact 30px coefficient, no error-driven
filter height jump, explicit wide-screen filters, opaque surfaces, rounded
clipped dialogs and default-phone choice. CLAUDE.md imports the contract and
context loading pointers only. Verify referenced authority sources exist and
Repowise generated sections remain byte-identical. No fake test success,
production permission or weaker gate may be introduced by the rewrite.

## QA-SESSION-GUARD-01
Latest prod inherited ShipmentContainerLedger at 911 lines above its frozen 905-line ceiling. Remove redundant whitespace only; preserve behavior and the ceiling. Run the unchanged structure guard and ledger cases.
