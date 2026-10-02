# QA-AUDIT-UI-18 — amount error matches the expense contract

In local generic expense create enter-30000 and click Lưu chi phí. Expected:
the original sign remains visible and the error explicitly says the amount must
be an integer greater than0; no expense is posted. Replace with30000 and submit
with required catalogs blank: only missing catalogs are rejected, not the amount.
Cancel and compare expense API snapshots. OPS signed credit flows retain their
own existing contract and require separate evidence.
