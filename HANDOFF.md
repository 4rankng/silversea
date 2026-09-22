# Current Development Handoff

**Updated:** 2026-09-22 ~15:00 (+08)
**Controller:** UI/UX sweep session (4 roles: chứng từ · điều vận · lái xe · OPS)
**Status:** Complete (sweep + tickets) — pushed and **deployed to prod** 2026-09-22 15:06 (+08), EXIT=0

## Goal

Full visual UI/UX sweep of every screen reachable by the four non-office roles (CUS `cus`,
DISPATCHER `dieuvan`, DRIVER `laixe`, OPS `giaonhan`) on local dev, plus the two staging
checks the user's screenshot pointed at — and a Kanban-PROD ticket per defect class found.

## Scope

Included:
- 29 screens × 3 viewports (1440 / 1920 / 390) captured + DOM-measured; screenshots and probe
  JSON in `qa/2026-09-22_ui-ux-sweep-4roles/` (gitignored), digest in
  `qa/2026-09-22_ui-ux-sweep_probe-digest.log`.
- 13 cards written to `Kanban-PROD/TODO/`: `20260922_20` … `20260922_32`.
- Test cases `TC-UI-01` … `TC-UI-13` in `testplan/2026-09-22-ui-ux-sweep-4-roles.md` (committed).
- Staging verification of two findings against build `bf6e659a` (CUS `thanhdc`).

Out of scope (not covered, per the report): write flows (create/dispatch/expense/POD) were only
observed statically; Safari/Firefox; < 360px; 2560px; print; keyboard/screen-reader pass.

## Decisions and sources

- **The user's screenshot is a deploy gap, not new code.** `Thao tác` = 0px reproduces on staging
  and is already fixed at HEAD by `8e21fbdf`; staging build `bf6e659a` (08:55) predates it
  (12:34). Card `20260922_21` therefore asks for a staging cut + regression, not a re-fix.
- Objective numbers only after false-positive filtering (hit-tested occlusion for off-canvas
  drawer/collapsed `<details>`, sr-only exclusion). Two probe artifacts (`overlappingText` on
  `/ops/wallet` mobile, mobile `clippedByViewport`) were verified against screenshots and
  **not** turned into findings — documented in `testplan/2026-09-22-ui-ux-sweep-4-roles.md` §4.
- Measurement harness: `qa/scripts/ui-sweep-4roles-20260922.mjs` (+ digest script). `qa/scripts/*`
  is gitignored, so the harness survives only in this checkout.

## Task-owned files

- `testplan/2026-09-22-ui-ux-sweep-4-roles.md` (committed `cf285f5d`, updated `43d6ed6b`)
- `scripts/kanban-cards-20260922-ui-ux-sweep.py` (committed, regenerates all 12 cards)
- `testplan/qa/evidence/2026-09-22_ui-ux-sweep-4roles/{REPORT.md,NOTES.md}` (gitignored)
- `qa/2026-09-22_ui-ux-sweep-4roles/**` (gitignored)
- Board: `Kanban-PROD/TODO/20260922_20` … `_31`

## Preserved concurrent changes

- `frontend/src/pages/accounting/DepositRefundTrackerPage.css` was modified by another lane at
  session start and had landed before my commit — untouched by this pass.
- `Kanban-PROD/TODO/20260922_8-chiho-dialog-edit-key-collision.docx` appeared mid-session from
  another lane; my cards were renumbered `8…19 → 20…31` to avoid the id collision.
- No application code was changed by this pass.

## QA

- Sweep run (screenshots + probes): `qa/2026-09-22_ui-ux-sweep_driver.log` — 0 console errors,
  0 page errors, 0 failed app requests across 87 viewport captures.
- Probe digest (desktop/wide/mobile): `qa/2026-09-22_ui-ux-sweep_probe-digest.log`.
- Repo gates: **not run** — no project file was modified (only `.md` + a `.py` generator), so
  lint/tsc/test/build are unaffected. Pre-commit hook ran clean on both commits.
- Commits: `cf285f5d`, `43d6ed6b` on `prod` (local; **not pushed** — repo rule keeps remotes
  untouched without instruction).

## Push + prod deploy (user-authorised 2026-09-22)

- Pushed: origin/prod = `5b4a8733` (0 commits behind, tree clean).
- Pre-deploy gates run and green: prod DB census (113 tracking rows, cursor = journal idx 112,
  the two new migrations idx 113/114 unapplied and idempotent, no tracking divergence);
  composition check (all 8 DEV_COMPLETED cards' landings in HEAD — 5 by sha, card `_5`/`_6`/`_7`
  by subject `b58dca61`+`41295af0`, `fca7be71`, `371c3d30`); deploy delta = 36 commits
  (12 fix / 4 feat / 13 test / …) since prod build `c9eb7756`.
- `make deploy` log: `qa/2026-09-22_prod-deploy_deploy.log` (full output + `EXIT=0`). Result: prod
  `buildHash=5b4a8733`; DB backup `.db-backups/db-20260922T070547Z.dump` (1.69 MB) taken before
  migrate; `[✓] migrations applied successfully`; prod tracking cursor advanced idx 112 → 114 (max);
  `shipment_rate_adjustment_requests` + its index exist; `treasury_accounts.fund_code IS NULL` = 0;
  `asset guard OK`; backend health ok (2nd attempt), frontend HTTP 200.
- Post-deploy prod smoke: `/` → `/login` renders ("Chào mừng trở lại" + 2 inputs + Đăng nhập), no
  asset errors; screenshot `qa/2026-09-22_prod-deploy_prod-login/prod-login-1440.png`.
  **Prod UI not driven past login — no prod credentials in `testplan/testaccounts.txt`.**
- Staging re-verified for card `20260922_21`: build `357b9ac7` now renders the `Thao tác` column
  at 89px with a 1-line header and working buttons (64×30 / 40×30, real click opened the confirm
  dialog). Card stays in TODO for the 1024–1200px band + the missing guard test.

## Blocker or next step

Lead triage of the 12 TODO cards. Priority order for the fixing lanes:
`20260922_23` (broken table headers/tokens, desktop **and** mobile) → `20260922_21` (staging cut
so the user stops seeing the 0px column) → `20260922_20` (pagination covering rows) →
`20260922_22` / `_24` → the rest. Any fix must re-run its `TC-UI-*` case on local **and** on the
next staging build.
