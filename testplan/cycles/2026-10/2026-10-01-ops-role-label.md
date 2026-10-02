# QA-AUDIT-UI-21 — Vận hành visible role label

Local ADMIN: open Users; select Vận hành category, inspect its count and user
rows, then open the role picker without saving. Expect “Vận hành” everywhere
that labels OPS, while persisted OPS/FORWARDER role IDs and access stay intact.
Exercise390/768/1440 under UI20 dropdown evidence and compare API snapshots.
