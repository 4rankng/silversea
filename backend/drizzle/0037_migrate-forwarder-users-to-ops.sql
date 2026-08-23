-- Forwarder→Ops role rename residue: environments seeded before the rename
-- (e.g. staging) still hold users.role='FORWARDER', which authenticates fine
-- but is denied every /api/forwarder/me/* advance + settlement endpoint the
-- OPS app depends on (Casbin policies key on OPS). Re-point those rows so the
-- seeded Ops account works without a manual data fix. No-op where the rename
-- already ran (local seeds create Role.OPS directly).
UPDATE "users" SET "role" = 'OPS' WHERE "role" = 'FORWARDER';
