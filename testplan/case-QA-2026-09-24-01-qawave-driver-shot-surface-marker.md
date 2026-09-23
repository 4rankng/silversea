# Case QA-2026-09-24-01 — qawave driver: shot surface truth + banner-proof captures (card `20260922_69`)

- **Case ID:** QA-2026-09-24-01
- **Reported:** 2026-09-22 by the lead (wave capture incident: *5/5 ảnh `*-full` kiểm tra đều sai chủ thể;
  7 ảnh loại bỏ*), card `20260922_69`, re-pinged 2026-09-24 for a fix rung.
- **Verbatim requirement:** *"(1) `shot <NN> full` trong qa/qawave-driver.sh chụp surface cũ/sai tab (eval và
  crop thì đúng) — cần chụp theo crop-of-shell (vd crop main.app-body) hoặc sửa full-mode; mọi ảnh full phải
  qua kiểm tra nội dung trước khi trích dẫn. (2) banner '⚠ --headed ignored: daemon already running' in ra
  stdout làm hỏng jq parsing của tapref/js (jq: parse error ở dòng 1) — cần tách stderr/stdout hoặc bỏ banner.
  (3) Thêm marker assert (pathname + content) vào shot."*
- **Surface:** `qa/qawave-driver.sh` — the capture instrument itself, not an app page. Every visual wave
  (worksheet `plans/reports/qa-wave-worksheet-2026-09-22.md`) cites its PNGs as evidence.
- **Status:** case LANDED — fix committed on `prod`; all three criteria re-run green (smoke below).

## Why this case exists (regression fence)

The driver is the instrument every visual wave trusts: writing a PNG under a `CARD/SCREEN/STATE` name claims
*"this image is that surface"*. On 2026-09-22 that claim was false 5 times out of 5 and neither the log nor
the file name said so — every image had to be opened and discarded by hand.

Reproduced red on 2026-09-24 (all three defects live at `78563dd6`):

| Defect | Symptom (observed) | Root cause (corrected by this rung) |
|---|---|---|
| **D1** | `launch /my-orders` → exit 0, log says the init-script was staged → the PNG is the **login page**. Second face: `screenshot --full` on the fixed shell yields a 4800×3740 canvas with the app in one corner (>75% void, table clipped). | A **live daemon keeps the options it started with**: a second `open` silently drops `--init-script`, the token never registers, the SPA guard bounces to `/login` — and `cmd_shot` had no content check, so it exited 0 anyway. `--full` expands the fixed shell instead of framing it. |
| **D2** | `tapref <sel>` → `jq: parse error: Invalid numeric literal at line 1, column 2` → `Missing arguments for: mouse move`; no pointer tap lands. | **Not the banner.** `agent-browser` writes `⚠ --headed ignored…` to **stderr**, which command substitution never captures (`open about:blank 1>o 2>e` proves it). The real cause is `get box` printing **plain text** (`x: 48`), so `jq '(.x + .width/2)'` could never parse it. stderr hygiene stays as belt-and-braces. |
| **D3** | Log line is only `screenshot full <path> -> exit 0`; nothing records which page was captured. | `cmd_shot` never probed the DOM before or after the capture, and no marker existed in the artefact. |

Also corrected: MiniMax's "asked `/my-orders`, captured `/my-trips`" case was **not** a driver defect —
`/my-orders` is `opsOnly` and `/my-trips` is `driverOnly` (`frontend/src/App.tsx:395,405`), so a DRIVER
account legitimately redirects. A driver must *report* that redirect, not crash on it.

## Steps (red-first, one precondition + one run)

```bash
export QAWAVE_CARD=20260922_69 QAWAVE_USER=cus QAWAVE_SCREEN=smoke QAWAVE_STATE=post
export QAWAVE_API=http://localhost:3002/api QAWAVE_ORIGIN=http://localhost:7175
# precondition — the D1 trap: a daemon already up WITHOUT the staged token
agent-browser --session qawave close; agent-browser --session qawave --headed open about:blank
bash qa/qawave-driver.sh login cus          # stages qa/.qawave-token-cus.js
bash qa/qawave-driver.sh launch /my-orders  # pre-fix: token dropped -> login page, exit 0
bash qa/qawave-driver.sh authcheck          # pre-fix: pathname=/login loginForm=true
bash qa/qawave-driver.sh shot 1 full        # pre-fix: citable PNG = wrong surface, no marker
bash qa/qawave-driver.sh tapref 'button[aria-label="Khách hàng"]'   # pre-fix: jq parse error
bash qa/qawave-driver.sh authcheck          # did the tap actually reach the element?
# negative gate — an unauthenticated surface must never produce a citable artefact
agent-browser --session qawave close; agent-browser --session qawave --headed open "$QAWAVE_ORIGIN/"
bash qa/qawave-driver.sh shot 3 full; echo "exit=$?"   # expect REFUSED, exit 1
```

## Expected behavior (post-fix)

| # | Expectation |
|---|---|
| 1 | `launch` survives a stale daemon: it closes the session first, so the staged token registers and the surface is the app, not `/login`. The launch line logs the reached `pathname` next to the requested path. |
| 2 | `shot <NN> full` writes a **crop of the app shell** (`main.app-body`) — bounded 1152×807 at 1200×863, never a void canvas — with a visible marker strip in the image (`QAWAVE <card> #<NN> <screen>/<state> <pathname> <clock>`), re-read after the capture; `page` keeps genuine full-page available. |
| 3 | Every shot line carries `[marker: <pathname> | <h1>]` (h1 falls back to header text; a differing launch path is appended as `(launched …)`). |
| 4 | `tapref` parses a real box (`get box --json` → `.data`) and dispatches `mouse move <x> <y>` at real coordinates. A tap on the sidebar "Khách hàng" control navigates `/shipments` → `/config/customers`. |
| 5 | A non-app surface (login/blank) is **REFUSED**: exit 1, artefact parked as `*_refused.png` (never the citable name), reason logged. `QAWAVE_ALLOW_NONAPP=1` opts in to capturing that surface on purpose. |
| 6 | `rotcheck` reports an **unquoted** event count and fails on 0 (dead input) — previously `"0"` ≠ `0` passed, so the dead-input guard could never fire. |

## Automated fence

Shell driver, so the fence is the re-runnable recipe above rather than a unit suite; `bash -n qa/qawave-driver.sh`
is the compile gate. Evidence (local — `qa/` and `testplan/qa/evidence/` are gitignored by design):

- RED: `qa/2026-09-24_20260922_69_redfirst-stale_pre_ui-1-full.png` (login page captured under a `/my-orders`
  launch), `qa/2026-09-24_c69-redfirst_ui-driver.log`, void face
  `testplan/qa/evidence/2026-09-23_c69-driver-fullshot/01-surface1-shipments-full.png` (4800×3740).
- GREEN: `qa/2026-09-24_c69fix_smoke-postfix.log` (commands + exit codes + full output),
  `qa/2026-09-24_c69fix_ui-driver.log` (markers per shot),
  `qa/2026-09-24_20260922_69_smoke-fix_post_ui-1-full.png` (shell crop + marker), `…_ui-3-full_refused.png`.

## Defects found by this rung (adjacent, fixed in the same file)

| ID | Severity | Symptom | Root cause | Fence |
|---|---|---|---|---|
| **D4** | MEDIUM | `rotcheck` could never fail: a dead-input session reported `rot events: "0"` and passed. | `js()` returns the eval result as a JSON **string**, so `count` was `"0"` (quotes included) and `[ "$count" != "0" ]` was true — the one case the guard exists for. | `qa/qawave-driver.sh` → `count=$(js '…' \| jq -r .)`; demo in the driver log: old `'"0"' != 0` → PASS (false), new `"0" == 0` → FAIL (correct). |

## Out of scope

- `agent-browser` itself, the app, and any page under test — the fix is driver-only.
- The app's RBAC redirect behaviour (`/my-orders` for a CUS account lands on its role home): correct
  application behaviour, now *reported* by the marker instead of being silently mislabelled.
- `.ua/` knowledge graph: `meta.json` records `8b26f5a9` against HEAD `78563dd6` (pre-existing staleness,
  untouched by this diff — a QA shell tool adds no graph-relevant surface).

## Not covered

- Mobile/coarse-pointer viewport (marker strip is `position:fixed` inside the crop target — untested at 390px).
- Roles other than CUS (DRIVER/OPS redirect paths, e.g. `/my-orders` for a DRIVER account).
- Staging (`https://vantai.tingting.vip`) — local dev only.
- Overlays: an open `[role=dialog]` rendered outside `main.app-body` is not inside the shell crop; the driver
  logs a note and the wave must use `shot <NN> crop '[role=dialog]'`.
- The marker-mismatch refusal path (page navigating mid-capture) was not induced in the smoke.
