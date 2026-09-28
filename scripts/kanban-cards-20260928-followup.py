#!/usr/bin/env python3
"""Generate Kanban-PROD TODO tickets for the issues found while FIXING the
2026-09-28 QA sweep (cards 152-159). Every remaining open issue gets a card
so nothing is tracked in chat only.

Run:
    python3 scripts/kanban-cards-20260928-followup.py
"""
import pathlib
import subprocess
import tempfile

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
def kanban_root() -> pathlib.Path:
    """Resolve the board directory recorded in .kanban-dir (see testplan/README)."""
    marker = REPO / '.kanban-dir'
    try:
        return pathlib.Path(marker.read_text(encoding='utf-8').strip()) / 'TODO'
    except OSError as err:
        raise SystemExit(f'cannot read board pointer {marker}: {err}') from err


KANBAN = kanban_root()
REPORT = 'testplan/cycles/2026-09/2026-09-28_human-qa-local-run.md'

CARDS = [
    {
        'num':'182',
        'slug':'root-lint-parse-noise-frontend-scratch',
        'case_id':'TC-LINT-SCOPE-001',
        'title':'Root `pnpm lint` vẫn đỏ: 29 chẩn đoán "Parsing error" rác ở script one-off của `frontend/`',
        'status':'MỞ — phát hiện khi sửa card 154 (2026-09-28)',
        'source':(
            f'Phần sửa của card 20260928_154. Báo cáo: `{REPORT}`. '
            'Lệnh: `pnpm lint` ở gốc repo.'
        ),
        'desc':[
            'Sau khi gate chạy được, nó lên 29 lỗi "Parsing error: No tsconfigRootDir was set, '
            'and multiple candidate TSConfigRootDirs are present" — nhưng **không lỗi nào là lỗi code**. '
            'Tất cả nằm ở các script one-off trong `frontend/` (vd `cus-qa*.mjs`, `design-lock/expectations/*.mjs`) '
            '— những file **không nằm trong tsconfig nào**, nên projectService không parse được.',
            'Đã thử và **không** giải quyết được bằng cách thêm ignore: `**/frontend/cus-qa.mjs` có trong '
            'ignore list, và `npx eslint frontend/cus-qa.mjs` chạy một mình **sạch** — nhưng khi chạy '
            '`eslint .` toàn repo thì lại lỗi. Đây là tương tác basePath/giải lập lúc sweep toàn repo, '
            'không phải lỗi của từng file.',
            'Cần một quyết định dứt điểm: hoặc gate chỉ phủ cây nguồn thật (frontend/src, backend/src, shared, '
            'testplan/qa) và **loại các script one-off ra khỏi phạm vi lint**; hoặc giữ chúng và cho chúng một '
            'khối non-type-aware riêng. Hiện gate báo đỏ vì tiếng ồn, làm mất khả năng dùng nó làm cổng.',
        ],
        'facts':[
            'Lệnh: `pnpm lint` (gốc) → `272 problems (31 errors, 241 warnings)`; 29/31 lỗi là Parsing.',
            'Lệnh: `npx eslint frontend/cus-qa.mjs` (file đơn) → 0 lỗi. Chỉ lỗi khi sweep toàn repo.',
            'File bị ảnh hưởng: `frontend/cus-qa*.mjs`, `frontend/design-lock/expectations/*.mjs`, `frontend/scripts/*.mjs`.',
            'Lỗi thật còn lại (đã sửa trong đợt này): 2 `no-unused-vars` ở `frontend/src/pages/debt-detail-ledger.tsx`.',
        ],
        'evidence':[],
        'ac':[
            '`pnpm lint` ở gốc **thoát 0** (hoặc chỉ đỏ vì lỗi code thật), không đỏ vì "Parsing error" trên file không nằm trong tsconfig.',
            'Quyết định scope được **ghi lại trong `eslint.config.mjs`** bằng comment, kèm lý do.',
            'Các script one-off bị loại thì **không mất** coverage thật của frontend/src, backend/src, shared, testplan/qa — verify bằng cách cố tình thêm 1 lỗi thật vào từng cây và xác nhận lint bắt được.',
            'Nếu chọn hướng "khối non-type-aware riêng cho script", phải **test** điều kiện đó chứ không tắt luôn rule.',
        ],
        'verify':[
            'Trước: `pnpm lint` → exit 1 với 29 Parsing error.',
            'Sau: `pnpm lint` → exit 0, output thật, không còn chữ "Parsing error".',
            'Kiểm tra phủ: thêm 1 biến unused vào `backend/src/services/quotation-export.service.ts` → lint phải bắt, rồi hoàn tác.',
        ],
    },
    {
        'num':'183',
        'slug':'backend-no-console-policy-decision',
        'case_id':'TC-LINT-POLICY-001',
        'title':'225 cảnh báo `no-console` ở `backend/src` — cần quyết định policy, không gộp vào đợt dọn',
        'status':'MỞ — cần CHIEF quyết policy (2026-09-28)',
        'source':(
            f'Phát hiện khi sửa card 20260928_154. Báo cáo: `{REPORT}`. '
            'Lệnh: `cd backend && npx eslint src`.'
        ),
        'desc':[
            'Bật lint cho `backend/` lần đầu tiên lộ **225 cảnh báo `no-console`** — toàn bộ ở script seed / '
            'CLI tooling (vd `backend/src/seed.ts`), nơi in ra console là đúng việc.',
            'Đây là **cảnh báo, không phải lỗi** — không làm gate đỏ. Nhưng 225 dòng cảnh báo mỗi lần chạy là tiếng '
            'ồn làm mất khả năng đọc lỗi thật.',
            'Backend có `pino` làm logger; nhưng script seed/CLI chạy một lần thì `console` là lựa chọn hợp lý. '
            'Đây là quyết định **policy**, không phải quyết định kỹ thuật thuần — nên tách riêng, không quyết '
            'kèm lúc dọn dead code.',
        ],
        'facts':[
            'Lệnh: `cd backend && npx eslint src` → `225 problems (0 errors, 225 warnings)`, tất cả `no-console`.',
            'Không lỗi nào còn lại: `0 errors` sau khi dọn 158 dead-code.',
            'Config hiện tại: khối backend bật `no-console: warn` (allow `error`/`warn`), copy từ config frontend.',
            'Đã **cố ý không** tự quyết: thêm ignore hay tắt rule đều là quyết định policy của team.',
        ],
        'evidence':[],
        'ac':[
            'CHIEF chọn một trong: (a) cho phép `console` trong `backend/src/seed*` + `backend/scripts/*` qua override có chủ đích; (b) chuyển seed/CLI sang `pino`; hoặc (c) giữ nguyên cảnh báo như một backlog riêng.',
            'Quyết định được viết thành comment trong `eslint.config.mjs`, nêu lý do.',
            'Sau khi quyết: `pnpm lint` output **không còn 225 dòng cảnh báo giống nhau** che lỗi thật, và các lỗi thật vẫn hiện.',
        ],
        'verify':[
            'Trước: `cd backend && npx eslint src` → 225 warnings, 0 errors.',
            'Sau: số warning giảm theo chính sách đã chọn, 0 lỗi thật bị che.',
        ],
    },
    {
        'num':'184',
        'slug':'frontend-css-contract-tests-9-retired-tokens',
        'case_id':'TC-FE-CSSCONTRACT-001',
        'title':'9 test CSS-contract còn ghim **token đã bị thay** (6 file) — phần còn lại của card 153',
        'status':'MỞ — chạy serial xác định (2026-09-28)',
        'source':(
            f'Phần còn lại của card 20260928_153. Báo cáo: `{REPORT}`. '
            'Lệnh: `cd frontend && npx vitest run`.'
        ),
        'desc':[
            'Sau khi dọn xong 11 case stale khác, còn **9 test / 6 file** đỏ **tất định** (không flaky — máy rảnh). '
            'Tất cả cùng một họ: **test CSS ghim design token đã bị migrate** (vd `--text-tertiary` → `--fg-3`). '
            'CSS là đúng; test còn ghim literal cũ.',
            'Đây là fallout của đợt migrate token. Đã sửa đúng pattern này 2 lần trước đó trong phiên này '
            '(`RecoverableCostsPage`, `ClerkShipmentCreatePage.styles`) — lần này là phần còn lại.',
        ],
        'facts':[
            '9 test đỏ trong 6 file:',
            '  - `bottom-nav.styles.test.ts` — "is fully opaque, not relying on backdrop-filter alone"',
            '  - `DetailedPlanClassification.styles.test.ts` (2) — unclassified variant / plain text không pill',
            '  - `DetailedPlanGrid.test.tsx` (3) — shared filter strip / 2 test "contrast-passing fallback" (token `--text-tertiary` → `--fg-3`)',
            '  - `WorkflowFinance.styles.test.ts` — wrap nội dung thay vì clip',
            '  - `mobile-touch-floor.styles.test.ts` — "leaves expense list action-button height to shared .btn"',
            '  - `selection-state-contract.styles.test.ts` — neutral ink thay vì màu ngữ nghĩa',
            'Lệnh: `cd frontend && npx vitest run` → `9 failed | 3209 passed (3218)`, 6 file đỏ.',
        ],
        'evidence':[],
        'ac':[
            'Token mới **được xác nhận resolve thật** (tra token trong design-system) trước khi ghim — không ghim typo.',
            'Không xoá assertion cho xanh; ghim lại **ý định**. Khác biệt bắt buộc: đổi tên token/giá trị thì ghim token MỚI; chỉ lệch khoảng trắng thì làm regex khoan dung khoảng trắng.',
            'Với assertion "để chiều cao cho `.btn` dùng chung" (mobile-touch-floor): phải đọc kỹ — ý nghĩa là **trang KHÔNG được tự khai báo chiều cao**, nên đừng đảo thành `toMatch`.',
            '`cd frontend && pnpm test` xanh, **chạy 2 lần** cho cùng kết quả (chứng minh tất định).',
        ],
        'verify':[
            'Trước: `cd frontend && npx vitest run` → 9 failed / 6 file.',
            'Sau: `Test Files 484 passed`, `Tests 3218 passed`, chạy 2 lần.',
            'Không regression: `cd frontend && npx tsc -b` exit 0; `npx eslint src` 0 lỗi.',
        ],
    },
    {
        'num':'185',
        'slug':'frontend-suite-load-flake-waitfor-timeouts',
        'case_id':'TC-FE-FLAKE-001',
        'title':'Suite frontend **flaky theo tải máy**: 2 lần chạy cho 2 tập fail khác nhau (timeout 15s)',
        'status':'MỞ — cần quyết định ngưỡng/concurrency (2026-09-28)',
        'source':(
            f'Tách khỏi card 20260928_153 (phần tất định đã sang card 20260928_184). Báo cáo: `{REPORT}`.'
        ),
        'desc':[
            'Chạy **cùng một cây**, cùng lệnh: lần 1 (máy tải nặng) `14 failed / 8 file`; lần 2 (máy rảnh) '
            '`9 failed / 6 file`, và **thời gian chạy tụt từ 596s xuống 98s**. Phần lớn lỗi là **timeout** '
            '`@testing-library/dom` (`getElementByLabelText` / `waitFor`) chứ không phải assertion sai.',
            'Nguyên nhân: pool nhiều worker + ngân sách thời gian mặc định 15s cho `waitFor`, khi CPU tranh '
            'chấp thì một render 25-dòng + nhiều await tuần tự vượt ngưỡng.',
            'Đây là **vấn đề gate**, không phải lỗi app: một suite đỏ chập chờn thì không dùng làm cổng được, '
            'và người ta sẽ sửa nhầm test đang không hỏng.',
        ],
        'facts':[
            'Chạy tải nặng: 596s, 14 failed / 8 file. Chạy rảnh: 98s, 9 failed / 6 file.',
            'Stack lỗi điển hình: `waitFor` / `getAllByLabelText` trong `ClerkShipmentCreatePage.test.tsx:1006` — "Test timed out in 15000ms".',
            'File đã có comment thừa nhận: `RecoverableCostsPage.test.tsx:222-225` — "15s budget … the 2026-09-10 load-flake (timed out twice in the suite, never isolated)".',
            'Cố ý **không** hạ timeout trong đợt này — hạ timeout để làm xanh là tự lừa mình.',
        ],
        'evidence':[],
        'ac':[
            'Một lần chạy **serial xác định** (ví dụ `--no-file-parallelism`) cho tập fail ổn định, chạy 2 lần ra cùng danh sách.',
            'Quyết định rõ: **tăng ngưỡng có lý do** (ghi lý do, không chỉ tăng số) **hoặc** giảm concurrency — và áp dụng nhất quán, không vá rải rác từng file.',
            'Suite xanh **cả** khi chạy song song trên máy tải — có bằng chứng chạy 2 lần song song.',
            'Các test đã có ngân sách 15s phải **thống nhất** về một quy ước, không phải mỗi file một kiểu.',
        ],
        'verify':[
            'Đo trước: `cd frontend && npx vitest run` (máy rảnh) vs (kèm tải nền) — ghi lại số fail + thời gian.',
            'Sau: cùng hai cách đo → cùng kết quả, 0 fail.',
        ],
    },
    {
        'num':'186',
        'slug':'boot-redis-timeout-handle-never-cleared',
        'case_id':'TC-BOOT-REDIS-001',
        'title':'`boot-redis`: handle của `setTimeout` không được giữ → không clear được, giữ event loop sống thêm mỗi lần boot',
        'status':'MỚI — phát hiện khi dọn dead code (2026-09-28)',
        'source':'Phát hiện khi dọn dead code card 20260928_154; `backend/src/lib/boot-redis.ts`.',
        'desc':[
            'Một lần dọn `no-unused-vars` từng báo `timer` là binding không dùng. Sau khi xem code: '
            '`setTimeout(...)` được gọi mà **không lưu handle**, nên không thể `clearTimeout`.',
            'Ý nghĩa thực tế: `verdict` được resolve sớm nếu `client.connect()` thành công, nhưng **timer vẫn treo** '
            'đến `timeoutMs + 500`. Vì vậy sau mỗi lần boot (kể cả khi Redis kết nối tức thì), Node event loop '
            'bị giữ thêm tới hạn đó. Bị chặn, tự kết thúc — **không rò bộ nhớ**, nhưng là chờ thừa không cần thiết.',
            'Không phải P0. Nhưng là loại "ai giữ handle thì ai dọn" mà không ai dọn — nên ticketed thay vì im lặng.',
        ],
        'facts':[
            'File: `backend/src/lib/boot-redis.ts`, khoảng dòng 34-41.',
            'Code: `setTimeout(() => resolve({ ok: false, ... }), timeoutMs + 500);` — không gán, không clear.',
            'Comment ngay dưới đã tự thừa nhận: "the timer only guards a hung connect (ioredis connectTimeout should fire first)".',
        ],
        'evidence':[],
        'ac':[
            'Handle được giữ và `clearTimeout` trong nhánh resolve sớm (nếu giữ handle là đủ) — hoặc giải thích bằng comment vì sao không cần.',
            'Không đổi **contract** của boot check: vẫn trả `ok: true/false` với cùng thông điệp lỗi.',
            'Có test hoặc ghi chứng minh: sau khi Redis OK, boot không còn đợi thêm `timeoutMs+500`.',
        ],
        'verify':[
            'Đo: instrument `process._getActiveHandles()` / log thời điểm boot kết thúc so với lúc process rảnh — trước vs sau.',
            'Không regression: `cd backend && npx tsc --noEmit` exit 0; unit suite 228/228.',
        ],
    },
    {
        'num':'187',
        'slug':'legacy-gate-sweep-syntax-error-unparseable',
        'case_id':'TC-QA-LEGACY-001',
        'title':'Script lưu trữ `_legacy/2026-09-10_gate-sweep.mjs` **không parse được** (thiếu ngoặc)',
        'status':'MỚI — phát hiện khi bật lint lần đầu (2026-09-28)',
        'source':'Phát hiện khi thêm lint vào `testplan/qa/`; `testplan/qa/scripts/_legacy/2026-09-10_gate-sweep.mjs`.',
        'desc':[
            'Script archive này **không parse được**: dòng 28 lệch ngoặc, `fs.mkdirSync(artifactsSync(OUT, { recursive: true });` '
            '— thiếu một dấu `)` đóng. Nó nằm trong `_legacy/` nên không ai chạy, nhưng vì vậy nó hỏng mà không ai biết.',
            'README nói `_legacy/` giữ script lưu trữ "để tham khảo". Một file tham khảo mà không parse được thì vô giá trị: '
            'không đọc được logic, không chạy lại được, chỉ làm nhiễu khi lint quét.',
            'Trong đợt này nó **được lint-ignore** (cùng `backend/scripts/archive/`) để khỏi báo đỏ giả. Đó là cách né, không phải cách sửa.',
        ],
        'facts':[
            'Lệnh: `node --check testplan/qa/scripts/_legacy/2026-09-10_gate-sweep.mjs` → `SyntaxError: missing ) after argument list` tại dòng 28.',
            'Lệnh: `pnpm lint` trước khi ignore → `Parsing error: Unexpected token ;` cho file này.',
        ],
        'evidence':[],
        'ac':[
            'File **parse được** (`node --check` sạch) — sửa ngoặc, hoặc ghi chú rõ vì sao nó vô dụng và cho phép xoá.',
            'Nếu giữ lại: nó nằm trong lint scope và không báo lỗi (nên đừng ignore nữa mà để nó sạch thật).',
            'Quyết định về cả thư mục `_legacy/`: giữ làm lịch sử thì phải **đọc được**; không giữ thì xoá có chủ đích.',
        ],
        'verify':[
            'Trước: `node --check <file>` → SyntaxError.',
            'Sau: `node --check <file>` exit 0.',
        ],
    },
    {
        'num':'188',
        'slug':'commit-cites-validation-script-never-existed',
        'case_id':'TC-PROCESS-VERIFY-001',
        'title':'Commit `5bd7d0b8` tự nhận đã validate bằng `check-migration-trio.mjs` — **script đó chưa từng được commit**',
        'status':'MỚI — phát hiện khi sửa card 152 (2026-09-28)',
        'source':'Phát hiện khi re-apply bản sửa journal (card 20260928_152); commit `5bd7d0b8`, bị revert bởi `c1075f25`.',
        'desc':[
            'Commit `5bd7d0b8` (bản sửa journal idx 127, bị revert 12 phút sau) viết trong message: '
            '**"Validated with `node scripts/check-migration-trio.mjs`"**.',
            'Script đó **không tồn tại**: `ls` → No such file; `git log --all --diff-filter=A` cho file đó → **rỗng**, '
            'nghĩa là **chưa bao giờ** được commit ở bất kỳ nhánh nào.',
            'Đây là một claim sai trong chính commit — đúng loại việc mà luật chống nói dối trong repo cấm. Không phải bug chạy được, '
            'nhưng làm giảm tin cậy vào "đã verify" của mọi commit message khác. Đáng ticket riêng vì nó là **vấn đề quy trình**, '
            'không sửa được bằng cách sửa code.',
        ],
        'facts':[
            'Lệnh: `ls scripts/check-migration-trio.mjs` → No such file or directory.',
            'Lệnh: `git log --all --oneline --diff-filter=A -- scripts/check-migration-trio.mjs` → **rỗng** (chưa bao giờ thêm).',
            'Trích message `5bd7d0b8`: "Validated with `node scripts/check-migration-trio.mjs`."',
            'Bối cảnh: bản sửa này đã bị revert bằng `c1075f25` 12 phút sau mà **không nêu lý do**.',
        ],
        'evidence':[],
        'ac':[
            'Điều tra **vì sao** `c1075f25` revert bản sửa 12 phút sau, và ghi lại lý do (lý do thật, không phải lý do hình thức).',
            'Nếu validation thật sự cần: viết `scripts/check-migration-trio.mjs` thật (nó có vẻ là kiểm tra bộ 3 file migration — journal/snapshot/sql khớp nhau).',
            'Luật: không được cite một lệnh verify trong commit message nếu lệnh đó không chạy được. Cân nhắc thêm bước CI kiểm tra script được cite có tồn tại.',
            'Journal phải giữ invariant contiguity xanh (đã làm trong card 152).',
        ],
        'verify':[
            'Lệnh: `git log --all --diff-filter=A -- scripts/check-migration-trio.mjs` → phải ra commit thật, hoặc card đóng với lý do "không cần script này".',
            'Nếu có script: `node scripts/check-migration-trio.mjs` exit 0 trên HEAD.',
        ],
    },
    {
        'num':'189',
        'slug':'two-blocked-cases-missing-env-tag',
        'case_id':'TC-QA-ENVMSG-001',
        'title':'2 case BLOCKED vẫn không ghi tên môi trường thật (REASSIGN, ROAD-ALLOWANCE)',
        'status':'MỞ — sót lại từ card 159 (2026-09-28)',
        'source':f'Tiến độ card 20260928_159. Báo cáo: `{REPORT}`.',
        'desc':[
            'Card 159 gắn `[${ctx.env.env}]` vào **các message BLOCKED/FAIL của 6 case được giao**. '
            'Hai case **mới đăng ký** trong card 155 (`TC-DISPATCH-REASSIGN-001`, `TC-ROAD-ALLOWANCE-001`) '
            'nằm ngoài phạm vi nên **chưa được gắn** — cả hai đều có **0** lần xuất hiện `env.env`.',
            'Cả hai đều trả BLOCKED **khi chạy local**, nhưng message không nói điều đó → đọc như một tuyên bố về staging trong ca chạy local. '
            'Đúng cái lỗi "rò rỉ chữ staging" mà card 159 sinh ra để dẹp.',
        ],
        'facts':[
            'Lệnh: `grep -c "env.env" TC-DISPATCH-REASSIGN-001.mjs TC-ROAD-ALLOWANCE-001.mjs` → **0** và **0**.',
            'BLOCKED quan sát được: REASSIGN — "Không tìm thấy ô điều phối nào có trạng thái Phân xe lại trước khi chuyến xuất phát"; ROAD-ALLOWANCE — "No route found with road_allowance for exactly one trailer type."',
            'Lệnh sweep để phát hiện: `grep -rln "verdict: .BLOCKED." testplan/qa/cases/ | xargs grep -L "env.env"`.',
        ],
        'evidence':[],
        'ac':[
            'Cả hai message có `[${ctx.env.env}]`.',
            '**Quét toàn bộ** `testplan/qa/cases/` — không còn case nào trả BLOCKED/FAIL mà không ghi env (chạy lệnh sweep ở trên, kỳ vọng rỗng).',
            'Case BLOCKED vẫn làm `run-all.mjs` exit khác 0 (đã đúng) — không được đổi thành PASS để "xanh".',
        ],
        'verify':[
            'Trước: `grep -c env.env <2 file>` → 0 / 0.',
            'Sau: sweep toàn repo trả về rỗng.',
            'Chạy lại topic `dispatch-sweep-2026-09-09`, xác nhận message mới có `[local]`.',
        ],
    },
    {
        'num':'190',
        'slug':'filter-audit-23-skips-unverified-not-pass',
        'case_id':'TC-FILTER-SKIP-001',
        'title':'23 surface bị **skip** trong filter audit là *chưa kiểm*, không phải *đã đạt* — cần phủ hoặc ghi rõ',
        'status':'MỞ — phát hiện trong ca QA 2026-09-28',
        'source':f'Báo cáo `{REPORT}`; `testplan/qa/evidence/20260928_humanqa_filter-audit/report.json` (`skipped: 23`).',
        'desc':[
            'Filter audit đo được 125 thanh, flag 2. Nhưng có **23 surface bị skip** — và skip **không phải là pass**. '
            'Nguyên nhân: một số surface không render `.filter-bar` dùng chung (`debt@1187`, `expense-accounting@1024`); '
            'phần còn lại bị **đẩy khỏi route** vì vai trò probe không vào được (`portal-statement`, `trips`, `dispatch-detail@768`, `fleet-*@768`, `ops-orders`, `admin-advance-settlements`).',
            'Rủi ro thật: nếu đọc "125 đo, 2 flag" mà quên 23 skip → tưởng đã phủ app, trong khi một phần bề mặt **chưa từng được đo**.',
        ],
        'facts':[
            'Lệnh: đọc `skipped` trong `testplan/qa/evidence/20260928_humanqa_filter-audit/report.json` → 23.',
            'Ví dụ skip: `portal-statement@390-1440` (7) redirect sang `/shipments`; `fleet-vehicles@768`, `fleet-drivers@768`, `fleet-external@768`; `ops-orders@1024/1440` redirect `/config`; `admin-advance-settlements` (3) redirect `/advances`.',
            'Không render `.filter-bar`: `debt@1187`, `expense-accounting@1024`.',
        ],
        'evidence':[],
        'ac':[
            'Mỗi skip có **lý do đã phân loại**: (a) surface thật sự không dùng `.filter-bar` dùng chung → ghi nhận là ngoài phạm vi; (b) surface CÓ dùng nhưng chưa được đo → phải bổ sung probe (đúng vai trò + route).',
            'Không còn skip nào là "vai trò probe bị chặn" — hoặc đã thêm đúng user, hoặc đã ghi rõ surface đó thuộc lane khác.',
            'Báo cáo run in **tổng skip** cùng số đo, để "125 đo, 2 flag" không bị đọc thành "app đã phủ".',
        ],
        'verify':[
            'Đo lại: `QA_BASE_URL=http://localhost:7175 node testplan/qa/scripts/ui-filter-audit-20260927.mjs` → đọc `skipped` trong `report.json`, từng dòng có lý do.',
            'Mục tiêu: giảm skip về 0, hoặc còn lại đều là ngoài phạm vi có ghi chú.',
        ],
    },
    {
        'num':'191',
        'slug':'local-db-throwaway-shipments-pollute-row-finders',
        'case_id':'TC-QA-FIXTURE-001',
        'title':'Ca QA để lại ~6 lô hàng rác ở đầu `/shipments` → mọi case "mở dòng đầu" bị đầu độc',
        'status':'MỞ — vệ sinh fixture local (2026-09-28)',
        'source':f'Báo cáo `{REPORT}`, mục "DB fixture hygiene".',
        'desc':[
            'Mỗi lần chạy `chungtu-regression`, 3 case PASS tạo mỗi case một lô hàng (khách `CF khách <random>`). '
            'Các lô đó **0 container**, và nằm **đầu danh sách** `/shipments`.',
            'Hậu quả trực tiếp: các case sau chọn "dòng đầu tiên" thì gặp lô 0 container → `CusContainerLedger` render '
            '`cus-detail-empty` và **không có bảng** → FAIL giả (đã thấy ở `TC-SHIP-DRAWER-001`, `TC-CUS-APPOINTMENT-001`).',
            'Đợt này đã sửa bằng cách chọn dòng **theo tính chất** (có container) thay vì theo vị trí. Nhưng dữ liệu rác vẫn nằm trong DB local.',
        ],
        'facts':[
            'Lệnh: `curl .../api/shipments?limit=3` → 3 id đầu `11197, 11196, 11195`, `blNumber=null`, `bookingRef=null`, khách `CF khách <rand>`.',
            'Lệnh: `curl .../api/shipments/<id>` cho 11192-11197 → `containers=0` tất cả.',
            'Lệnh reset chuẩn của repo: `cd backend && pnpm db:reset && pnpm db:seed`.',
        ],
        'evidence':[],
        'ac':[
            'DB local sạch: đầu `/shipments` không còn lô `CF khách <random>` do test sinh.',
            'Có cách dọn **lặp lại được** sau mỗi ca: hoặc script `db:reset` trong quy trình QA, hoặc case tự xoá lô mình tạo.',
            'Không mất dữ liệu nghiệp vụ thật — chỉ xoá fixture do test sinh (nhận diện được qua tiền tố khách / mã).',
        ],
        'verify':[
            'Trước: 3 id đầu là `CF khách <rand>`, `containers=0`.',
            'Sau: 3 id đầu là lô seed thật, có container.',
            'Chạy lại `node testplan/qa/scripts/run-all.mjs chungtu-regression` rồi `shipments-qa` → kết quả **không đổi** giữa 2 lần chạy liên tiếp.',
        ],
    },
    {
        'num':'192',
        'slug':'frontend-dev-port-7174-vs-7175-footgun',
        'case_id':'TC-DEVENV-PORT-001',
        'title':'Frontend chạy lệch port (7174 vs 7175) khiến harness trỏ nhầm API — footgun phát hiện khi dựng stack',
        'status':'MỞ — cải thiện quy trình dev (2026-09-28)',
        'source':'Gặp khi dựng lại dev stack cho ca QA 2026-09-28.',
        'desc':[
            'Có **hai contract port** cùng tồn tại: `frontend/vite.config.ts:46` đặt `port: 7174`, còn `Makefile` '
            'chạy `npx vite --port 7175` với `VITE_API_PROXY_TARGET=http://localhost:3002`. Harness mặc định `7175`.',
            'Chạy `pnpm dev` trong `frontend/` → lên **7174**, và **không** kèm proxy override → frontend proxy về **3001**, '
            'trong khi backend chạy ở **3002`. Harness sẽ chạy nhưng gọi sai API (lỗi kiểu 401/403 rất khó đoán nguyên nhân).',
            'Không phải bug sản phẩm — là **footgun quy trình**. Đáng ghi nhận vì nó âm thầm làm hỏng mọi ca QA chạy bằng lệnh ngắn.',
        ],
        'facts':[
            'Lệnh: `grep -n "7174\\|7175" frontend/vite.config.ts Makefile` → vite.config đặt 7174; Makefile ép 7175.',
            'Hệ quả: `pnpm dev` trong frontend → 7174 + proxy mặc định (3001); harness kỳ vọng 7175 + API 3002.',
            'Đã gặp thật trong phiên này: `pnpm dev` fail vì 7174 bận, phải dựng lại theo đúng Makefile.',
        ],
        'evidence':[],
        'ac':[
            'Một trong hai: (a) `vite.config.ts` đổi default còn 7175 khớp Makefile + harness; hoặc (b) giữ 7174 nhưng **sửa** `Makefile` + mặc định `lib/env.mjs` + mọi script để 7174. **Chọn một và làm khớp hết.**',
            'Lệnh dev chuẩn ghi rõ port + proxy, và chạy được từ cả gốc lẫn `frontend/`.',
            'Harness fail **rõ ràng** nếu API không khớp port mong đợi (vd health check trả về 404/connection refused → báo sai port kèm gợi ý), thay vì âm thầm test sai endpoint.',
        ],
        'verify':[
            'Trước/sau: `grep -n "port" frontend/vite.config.ts Makefile` + `node testplan/qa/scripts/smoke.mjs` — port trong log phải khớp số backend thật.',
            'Không regression: `cd frontend && npx tsc -b` exit 0; QA topics vẫn xanh.',
        ],
    },
]


def render(card: dict) -> str:
    lines = [
        f"## {card['title']}", '',
        f"Trạng thái: {card['status']}", '',
        f"Nguồn: {card['source']}", '',
        '### Mô tả lỗi', '',
    ]
    lines += [f"- {p}" for p in card['desc']]
    lines += ['', '### Bằng chứng', '']
    lines += [f"- {f}" for f in card['facts']]
    for rel, caption in card['evidence']:
        lines += ['', f"![{caption}]({REPO / rel})", '', f"*{caption}*"]
    lines += ['', '### Tiêu chí nghiệm thu', '']
    lines += [f"{i}. {a}" for i, a in enumerate(card['ac'], 1)]
    lines += ['', '### Hướng dẫn xác minh', '']
    lines += [f"{i}. {v}" for i, v in enumerate(card['verify'], 1)]
    lines += [
        '', '### Case QA', '',
        f"`{card['case_id']}` — `{REPORT}`. Chạy lại lệnh verify ở trên trước khi chuyển card sang QA_PASSED.", '',
    ]
    return '\n'.join(lines)


def main() -> None:
    for card in CARDS:
        md = render(card)
        name = f"20260928_{card['num']}-{card['slug']}"
        with tempfile.NamedTemporaryFile('w', suffix='.md', delete=False, encoding='utf-8') as fh:
            fh.write(md)
            src = fh.name
        out = KANBAN / f"{name}.docx"
        subprocess.run(
            ['pandoc', src, '-o', str(out), '--from', 'markdown', '--resource-path', str(REPO)],
            check=True,
        )
        print(f'wrote {out.name} ({out.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
