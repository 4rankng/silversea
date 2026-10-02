#!/usr/bin/env python3
"""Generate Kanban-PROD TODO tickets for the 2026-09-28 human-QA local sweep.

Every card is self-contained on the Drive board (no local-path-only references
for the *evidence* claim; the markdown spec that carries the full run report is
referenced by repo path, which the board has always accepted).

Run:
    python3 scripts/kanban-cards-20260928-qa-sweep.py
"""
import pathlib
import subprocess
import tempfile

REPO = pathlib.Path('/Volumes/LexarSSD/projects/silversea-prod')
KANBAN = pathlib.Path(
    open(REPO / '.kanban-dir').read().strip()
) / 'TODO'
REPORT = 'testplan/cycles/2026-09/2026-09-28_human-qa-local-run.md'
HEAD = 'e778edcc'

CARDS = [
    dict(
        num='152',
        slug='drizzle-journal-idx-127-reverted',
        case_id='TC-MIG-JOURNAL-001',
        title='P0: `pnpm test:unit` đỏ — journal drizzle mất chỉ số 127, bản sửa đã bị revert',
        status='MỞ — ca QA 2026-09-28 (local dev, HEAD `' + HEAD + '`)',
        source=(
            f'Ca QA toàn diện `testplan/` ngày 2026-09-28, mục **F-1** của báo cáo `{REPORT}`. '
            'Gate bắt buộc trước push: `cd backend && pnpm test` (`testplan/roles/README.md` §6 và `testplan/qa/_TEMPLATE.md`).'
        ),
        desc=[
            '`backend/drizzle/meta/_journal.json` có **132 phần tử nhưng chỉ số `idx` chạy 0–126, 128–132 — mất `127`**. Tripwire của chính repo (`backend/src/tests/helpers/journal-invariants.ts:51`) đòi `idx` liên tục từ 0, nên `o2c-rev1.migration-safety.test.ts` đỏ ngay từ câu đầu tiên.',
            '**Không mất migration nào**: đã đếm bằng script — 132 file `.sql` ↔ 132 entry, **0 file mồ côi**, **0 tag không có file**, và chuỗi `when` đơn điệu. Thứ tự áp dụng vẫn đúng. Lỗi nằm ở lỗ hổng bộ đếm `idx`, đúng như mô tả commit `5bd7d0b8`.',
            'Nguồn gốc: commit `19a7762` **thay thế tại chỗ** entry `idx: 127` (`20260924021509_high_valkyrie`) bằng `20260924035509_seed_name_suffix_strip`, nên slot 127 biến mất khỏi chuỗi.',
            'Lịch sử: `a43676ce` + `17907a5d` thêm lại file và restamp tag; `5bd7d0b8` ("fix(db): repair the drizzle journal index gap (idx 127 was missing)", 19:39) đánh số lại 5 entry cuối cho liên tục; **`c1075f25` revert bản sửa đó 12 phút sau (19:51) mà KHÔNG nêu lý do.**',
            'Hậu quả trực tiếp: gate bắt buộc trước push đang đỏ trên HEAD, và repo đang ở trạng thái "biết là đỏ mà im lặng" — cái tệ nhất trong ba lựa chọn.',
        ],
        facts=[
            'Số đo: `Test Files` không liên quan; đơn vị test `228 tests / 227 pass / 1 fail`.',
            'Assertion: `AssertionError [ERR_ASSERTION]: entry 127 has idx 128 — journal indices must be contiguous from 0 (128 !== 127)`.',
            '5 vị trí lệch idx/position: position 127→idx 128 (`20260924035509_seed_name_suffix_strip`), 128→129, 129→130, 130→131, 131→132.',
            'Lệnh tái hiện: `cd backend && npx tsx --test \'src/tests/unit/*.test.ts\'` (hoặc `pnpm test:unit`).',
            'Bản sửa còn nguyên trong lịch sử: `git show 5bd7d0b8 -- backend/drizzle/meta/_journal.json` (chỉ đổi metadata, **không file `.sql` nào đổi**).',
        ],
        evidence=[],
        ac=[
            '`journal-invariants` xanh: `entry.idx === position` cho mọi entry, `0..131` liên tục, không tag trùng, mọi entry có file `.sql`.',
            'Số file `.sql` trong `backend/drizzle/` **bằng** số entry journal, 0 file mồ côi, 0 entry thiếu file.',
            'Chuỗi `when` vẫn đơn điệu tăng (thứ tự áp dụng không đổi).',
            '`cd backend && pnpm test:unit` xanh 228/228; `pnpm test` (unit + integration) xanh.',
            'Ghi rõ quyết định: hoặc re-apply `5bd7d0b8`, hoặc — nếu `c1075f25` revert vì một lý do thật — sửa lại invariant đi kèm lý do. **Không để HEAD đỏ trong im lặng.**',
        ],
        verify=[
            'Trước khi sửa: `cd backend && npx tsx --test \'src/tests/unit/*.test.ts\'` → 1 fail, thấy `entry 127 has idx 128`.',
            'Sau khi sửa: lệnh trên → 0 fail, `ℹ fail 0`.',
            'Kiểm tra chéo: `node -e "const j=require(\'./drizzle/meta/_journal.json\');j.entries.forEach((e,i)=>{if(e.idx!==i)console.log(\'MISMATCH\',i,e.idx,e.tag)})"` in ra rỗng.',
            'Kiểm tra chéo số file: `ls drizzle/*.sql | wc -l` bằng `j.entries.length`.',
            'Chạy lại `node scripts/check-migration-trio.mjs` (bộ kiểm mà commit `5bd7d0b8` dùng để validate).',
        ],
    ),
    dict(
        num='153',
        slug='frontend-vitest-red-and-flaky',
        case_id='TC-FE-TEST-001',
        title='P0: `pnpm test` frontend đỏ **và không ổn định** — 2 lần chạy cho 2 tập fail khác nhau',
        status='MỞ — ca QA 2026-09-28 (local dev, HEAD `' + HEAD + '`)',
        source=(
            f'Ca QA toàn diện `testplan/` ngày 2026-09-28, mục **F-7** của báo cáo `{REPORT}`. '
            'Gate bắt buộc trước push: `cd frontend && pnpm test`.'
        ),
        desc=[
            '**Run 1:** `Test Files 8 failed | 476 passed (484)` · `Tests 14 failed | 3204 passed (3218)` · 596s.',
            '**Run 2** (cùng lệnh, chạy một mình không tải song song): tập fail **khác và lớn hơn** — khoảng 26 test đặt tên rải trên ~11 file, phần lớn là **timeout** của `@testing-library/dom` (`getElementByLabelText` / `waitFor`), ví dụ `ClerkShipmentCreatePage.test.tsx:1006` — "Test timed out in 15000ms".',
            'Hai lần chạy cùng một cây mà cho kết quả khác nhau ⇒ suite **flaky dưới tải**, không phải một regression dịch chuyển. **Không ai được bắt đầu sửa từng test cho tới khi có một lần chạy serial sạch để chốt tập thật.**',
            'Đã xác nhận ít nhất một test **thực sự cũ** (cùng họ với selector drift): `ClerkShipmentCreatePage.styles.test.ts:224` đòi source trang chứa `className="csc-route-picker"`, nhưng class đó đã chuyển sang `features/shipments/create/ShipmentCreateLclRouteSection.tsx` (và `ShipmentCreateContainerRow.tsx`) sau đợt tách form tạo lô hàng. 7 case đỏ trong file đó đều là assertion **so khớp text nguồn** với một trang mà JSX đã nằm chỗ khác.',
        ],
        facts=[
            'Khu vực đỏ: `ShipmentsPage.test.tsx` (5 — CUS closeout workspace / card 20260923_1), `ClerkShipmentCreatePage.styles.test.ts` (7), `ClerkShipmentCreatePage.test.tsx` (3), `TripListPage.test.tsx` (2, gồm pin card 20260927_152), `RecoverableCostsPage.test.tsx` (2), `ExpenseCashDrawer`, `OpsExpenseCatalogRecovery`, `ShipmentCreateWorkspace.mode-toggle`, `master-data-name-forms`, và 2 suite hợp đồng `control-density.styles` + `operational-color-contract.styles`.',
            'Lệnh tái hiện: `cd frontend && npx vitest run --reporter=dot`.',
            'Timeout 15000ms mặc định của vitest là nghi vấn số một khi chạy song song với job khác trong CI.',
            'Đã loại trừ: cả 2 typecheck đều xanh (`cd frontend && npx tsc -b` → 0 errors), nên không phải lỗi type.',
        ],
        evidence=[],
        ac=[
            'Một lần chạy serial (`--no-file-parallelism` hoặc pool=1) cho **tập fail xác định và ổn định** — chạy 2 lần liên tiếp ra cùng một danh sách.',
            'Mọi case đỏ còn lại đều được phân loại: **sửa được** (kể cả assertion source-text cũ) hoặc **ghi nhận + ticket riêng** — không còn case đỏ không ai nhận.',
            'Các assertion so khớp **text nguồn** với JSX đã tách phải trỏ tới đúng file mới hoặc được bỏ — không được để chờ một lần refactor tương lai.',
            '`cd frontend && pnpm test` xanh ở HEAD, và xanh lần chạy thứ hai (bằng chứng chống flake).',
            'Nếu flake là do timeout, nêu ngưỡng mới và **lý do**; không hạ timeout để làm xanh.',
        ],
        verify=[
            'Sau khi sửa: `cd frontend && npx vitest run --reporter=dot` → `Test Files  0 failed`, chạy 2 lần.',
            'Kiểm tra riêng: `cd frontend && npx vitest run src/pages/clerk/ClerkShipmentCreatePage.styles.test.ts` → xanh.',
            'Kiểm tra riêng: `cd frontend && npx vitest run src/pages/ShipmentsPage.test.tsx` → xanh.',
            'Chạy song song có tải nền cố ý 1 lần để xác nhận không còn phụ thuộc tốc độ máy.',
        ],
    ),
    dict(
        num='154',
        slug='pnpm-lint-broken-at-root-no-backend-config',
        case_id='TC-LINT-001',
        title='`pnpm lint` ở gốc repo **không chạy được**; backend không hề có eslint config',
        status='MỞ — ca QA 2026-09-28 (local dev, HEAD `' + HEAD + '`)',
        source=(
            f'Ca QA toàn diện `testplan/` ngày 2026-09-28, mục **F-5** của báo cáo `{REPORT}`. '
            '`pnpm lint` được ghi là lệnh Build/Lint/Dev trong `.claude/CLAUDE.md` và là gate bắt buộc trong `testplan/roles/README.md` §6.'
        ),
        desc=[
            '`pnpm lint` ở gốc repo chết ngay lập tức: `ESLint couldn\'t find an eslint.config.(js|mjs|cjs) file.` (exit 2). Lệnh được tài liệu hóa là gate "mọi thay đổi" nhưng **chưa bao giờ chạy được theo đúng tài liệu**.',
            'Trong cả repo chỉ có `frontend/eslint.config.js`. **`backend/` không có file eslint nào** ⇒ không file backend nào được lint bởi bất kỳ lệnh nào trong tài liệu.',
            'Lệnh duy nhất chạy được là `cd frontend && npx eslint .` — và lệnh đó **cũng đỏ**: `✖ 21 problems (4 errors, 17 warnings)`. Cả 4 error đều là `no-useless-escape` trong file test: `features/dispatch/master-plan/MasterPlanGrid.date-pair.verify.styles.test.ts:36` và `MasterPlanGrid.test.tsx:665, 685`.',
        ],
        facts=[
            'Lệnh: `pnpm lint` (gốc) → exit 2, không có config. `find . -maxdepth 2 -name \'eslint.config.*\' -not -path \'./node_modules/*\'` → chỉ `./frontend/eslint.config.js`.',
            'Lệnh: `cd frontend && npx eslint .` → `✖ 21 problems (4 errors, 17 warnings)`.',
            '17 warning đều là `react-hooks/exhaustive-deps` / `no-explicit-any` / `no-console` — có giá trị, không ép xanh giả.',
            'Cả hai typecheck đều xanh, nên lint và typecheck không trùng nhau: đang có **hai lớp kiểm khác nhau, một lớp hỏng**.',
        ],
        evidence=[],
        ac=[
            '`pnpm lint` ở gốc repo **chạy được** và phủ **cả `frontend/` lẫn `backend/`** (một flat config ở gốc, không phải sửa script che mất vấn đề).',
            'Backend có luật lint thật: chạy `pnpm lint` phải quét được `backend/src` (ít nhất là TypeScript + rule sai nghiêm ngặt hơn 0 error).',
            '4 error `no-useless-escape` được sửa ở nguồn, không bằng cách tắt rule.',
            '17 warning còn lại được **phân loại**: sửa, hoặc ghi nhận có chủ đích bằng `eslint-disable` có lý do — không để trôi.',
            'Cùng lệnh chạy sạch ở HEAD, và tài liệu (`CLAUDE.md` Commands, `roles/README.md` §6) khớp với lệnh thật.',
        ],
        verify=[
            'Trước: `pnpm lint` → `ESLint couldn\'t find an eslint.config.(js|mjs|cjs) file`, exit 2.',
            'Sau: `pnpm lint` → có output thật, exit 0 (hoặc exit khác 0 **vì** có lỗi thật, không phải vì không có config).',
            'Kiểm tra phủ backend: đưa 1 file backend cố ý viết sai vào, `pnpm lint` phải bắt được, rồi hoàn tác.',
            'Kiểm tra riêng frontend: `cd frontend && npx eslint .` → 0 error.',
        ],
    ),
    dict(
        num='155',
        slug='three-orphan-cases-never-registered',
        case_id='TC-QA-REG-001',
        title='3/9 case trong `dispatch-sweep-2026-09-09` không được đăng ký — một case **PASS** không bao giờ chạy',
        status='MỚI — phát hiện bởi ca QA 2026-09-28',
        source=(
            f'Ca QA toàn diện `testplan/` ngày 2026-09-28, mục **F-3** của báo cáo `{REPORT}`. '
            'Đối chiếu `ls testplan/qa/cases/<topic>/` với `index.mjs` cho cả 3 topic.'
        ),
        desc=[
            '`testplan/qa/cases/dispatch-sweep-2026-09-09/` có **9 file case** nhưng `index.mjs` chỉ đăng ký **6**. Ba case mồ côi **không bao giờ chạy** qua `run-all.mjs`.',
            'Nghiêm trọng nhất: **`TC-DV-DISPATCH-051` PASS** khi chạy tay (9.5s). Nghĩa là có một case đang **bắt được regression thật nhưng không bao giờ được chạy**, trong khi topic báo cáo "6 case" và kết thúc với dòng trông như xanh. Một topic xanh hiện có thể **giấu một test PASS-không-chạy**.',
            'Hai case còn lại cũng không được chạy, và cả hai đều BLOCKED khi chạy tay — tức là chúng phụ thuộc fixture mà local dev không có.',
        ],
        facts=[
            'Đếm bằng script: `chungtu-regression` 8 file / 8 đăng ký ✔ · `shipments-qa` 5 file / 5 đăng ký ✔ · `dispatch-sweep-2026-09-09` **9 file / 6 đăng ký** ✘.',
            '`TC-DV-DISPATCH-051.mjs` → `run-case.mjs` → **PASS (9483ms)**. Evidence: `testplan/qa/evidence/2026-09-27T17-50-21-187Z_29535_TC-DV-DISPATCH-051/`.',
            '`TC-DISPATCH-REASSIGN-001.mjs` → BLOCKED: "Không tìm thấy ô điều phối nào có trạng thái Phân xe lại trước khi chuyến xuất phát".',
            '`TC-ROAD-ALLOWANCE-001.mjs` → BLOCKED: "No route found with road_allowance for exactly one trailer type."',
            'Ba BLOCKED này **không** xuất hiện trong bất kỳ lần chạy topic nào, nên từng bị coi là "đã kiểm" một cách sai lệch.',
        ],
        evidence=[],
        ac=[
            'Mọi file case trong mỗi topic đều được khai báo ở `index.mjs`, **hoặc** được ghi rõ lý do không chạy (fixture chỉ có trên staging) tại một nơi duy nhất.',
            'Có một kiểm tra ngăn hồi quy: một script/lint assert "số file case trong topic == số entry trong index.mjs", chạy trong QA gate.',
            '`TC-DV-DISPATCH-051` chạy trong `run-all.mjs dispatch-sweep-2026-09-09` và PASS được ghi vào `results.json`.',
            'Hai case BLOCKED được phân loại rõ: hoặc có nhánh BLOCKED có chủ đích và được tính vào exit code, hoặc được dời sang topic riêng có ghi chú staging-only.',
        ],
        verify=[
            'Trước: `node testplan/qa/scripts/run-all.mjs dispatch-sweep-2026-09-09` in "— role ADMIN: 6 case(s)".',
            'Sau: in "9 case(s)" (hoặc 7 nếu 2 case staging-only được tách ra có ghi chú), và `results.json` chứa `TC-DV-DISPATCH-051` với verdict PASS.',
            'Kiểm tra ngăn hồi quy: script đếm file vs entry phải ra 0 sai lệch cho cả 3 topic.',
        ],
    ),
    dict(
        num='156',
        slug='create-flow-pixel-driver-captures-nothing',
        case_id='TC-QA-EVID-001',
        title='Driver `ui-create-flow-pixel-20260927.mjs` chụp **không có gì** nhưng vẫn exit 0 — evidence âm thầm vô dụng',
        status='MỚI — phát hiện bởi ca QA 2026-09-28',
        source=(
            f'Ca QA toàn diện `testplan/` ngày 2026-09-28, mục **F-4** của báo cáo `{REPORT}`. '
            'Evidence: `testplan/qa/evidence/2026-09-27-17-38-40_create-flow-pixel/shot-meta.json`.'
        ),
        desc=[
            'Driver **không chụp được gì** nhưng in dòng thành công và exit 0. Người đọc artifact tưởng đã có before/after pixel diff, thực tế là hai ảnh trang trắng.',
            '`shot-meta.json` ghi lại, ở bề rộng **1440**, **mọi** lần pick đều là `no-trigger` / `no-input`; ở 390 chỉ 3 cái "thành công". Ảnh `shot-1440-with-data.png` là trang **"Đang tải..."** — không có form nào được render.',
            'Nguyên nhân gốc: **selector cũ**. Cảnh tạo lô hàng không dùng các hook mà driver đoán.',
        ],
        facts=[
            'Hook thật trên form tạo lô hàng (đo bằng probe trực tiếp lên `/shipments/new`):',
            '  - Khách hàng: input React-Aria `role="combobox"` **không có** `aria-label` (driver đoán `input[aria-label="Khách hàng"]` / `#customerId` → không có).',
            '  - Hình thức nhập/xuất: `<button class="csc-uui-field">` chữ "— Chọn hình thức —" (driver đoán `input[placeholder="Chọn Nhập hoặc Xuất"]` → không có).',
            '  - `Loại container` / `Nhà máy` / `Cảng nâng` / `Cảng hạ`: combobox **có** `aria-label`, nhưng chỉ tồn tại **sau khi đã thêm 1 container** (id dạng `container-<uuid>-...`).',
            '  - `Số container` / `Trọng lượng (kg)`: chỉ nằm trong form thêm container, không có ở trạng thái rỗng.',
            'Các pick "thành công" cũng đáng nghi: `route`, `pickup=Cảng Hải Phòng`, `dropoff=Cảng Hải Phòng` — selector option không có scope nào, và ba field khác nhau trả về **cùng một giá trị**.',
            '**Trang tạo lô hàng không hỏng**: probe trực tiếp `/shipments/new` ổn định sau <2s, heading `Tạo lô hàng / Nhận diện lô / Thông tin hàng / Lịch & ghi chú`, 23 input, 0 request lỗi.',
        ],
        evidence=[
            ('testplan/qa/evidence/2026-09-27-17-38-40_create-flow-pixel/shot-1440-with-data.png',
             'Ảnh "with-data" tại 1440 — thực chất là trang "Đang tải..." trống, form chưa kịp render'),
            ('testplan/qa/evidence/2026-09-27-17-38-40_create-flow-pixel/shot-meta.json',
             'Metadata ghi mọi pick ở 1440 đều `no-trigger` / `no-input` — bằng chứng driver không chụp được gì'),
        ],
        ac=[
            'Driver chụp được **cả 2 trạng thái** (rỗng + có dữ liệu) ở mỗi bề rộng, và ảnh **không còn** là trang trắng / "Đang tải...".',
            'Mọi pick bắt buộc tìm thấy control thật; **không còn** giá trị nào bắt đầu bằng `no-trigger` / `no-input` trong `shot-meta.json`.',
            'Ba field `route` / `pickup` / `dropoff` trả về **giá trị khác nhau** như bản chất dữ liệu, và option selector **có scope** vào listbox vừa mở.',
            '**Driver exit khác 0** khi không chụp được gì — một ca thất bại phải trông như thất bại, không được trông như thành công.',
            'Chạy lại 2 lần cho ra artifact giống nhau (deterministic).',
        ],
        verify=[
            'Trước: `QA_BASE_URL=http://localhost:7175 node testplan/qa/scripts/ui-create-flow-pixel-20260927.mjs` → in dòng "shot: build=dev …" và **exit 0**, trong khi `shot-meta.json` toàn `no-trigger`.',
            'Sau: cùng lệnh → `shot-meta.json` **không còn** `no-trigger`/`no-input` nào, ảnh có form thật, exit 0.',
            'Cố tình làm hỏng một selector → driver phải **exit khác 0** kèm thông báo nói rõ không chụp được gì.',
        ],
    ),
    dict(
        num='157',
        slug='customer-role-untestable-by-harness',
        case_id='TC-QA-ACCT-001',
        title='Vai trò CUSTOMER không test được bằng harness — `testaccounts.txt` thiếu hẳn khoá role',
        status='MỚI — phát hiện bởi ca QA 2026-09-28',
        source=(
            f'Ca QA toàn diện `testplan/` ngày 2026-09-28, mục **F-6** của báo cáo `{REPORT}`. '
            'Runtime: `login failed: no username for role CUSTOMER in env local`.'
        ),
        desc=[
            '`testplan/roles/07-khachhang.md` tồn tại và `shared` định nghĩa role `CUSTOMER`, nhưng `testplan/testaccounts.txt` **không có khoá `CUSTOMER:`** trong block `local:` lẫn `staging:`. Hai tài khoản khách hàng (`samsung-cs`, `canon-cs`) chỉ nằm trong danh sách văn xuôi `demoUsers:` ở cuối file.',
            'Hệ quả: `env.candidatesFor(\'CUSTOMER\')` trả về `[]`, `smoke.mjs` không bao giờ probe vai trò này, và **bất kỳ case nào tag CUSTOMER đều không đăng nhập được**. Toàn bộ portal khách hàng (`/portal/shipments`, `/portal/debit-notes`, `/portal/statement`) nằm ngoài tầm kiểm của harness.',
            'Đây là khoảng trống **âm thầm**: board có tài liệu walkthrough cho vai trò này, nên dễ tưởng là đã được cover.',
        ],
        facts=[
            'Khoá role thực sự có trong `testaccounts.txt`: `ADMIN, MANAGER, ACCOUNTANT, CUS, DISPATCHER, OPS, DRIVER` — **không có CUSTOMER**.',
            '`testplan/qa/scripts/smoke.mjs:16` probe `[\'ADMIN\',\'MANAGER\',\'ACCOUNTANT\',\'CUS\',\'DISPATCHER\',\'DRIVER\',\'OPS\']` — cũng không có CUSTOMER.',
            'Runtime xác nhận: probe AUTH-03 với role CUSTOMER → `login failed: no username for role CUSTOMER in env local; check testplan/testaccounts.txt`.',
            '`testplan/roles/07-khachhang.md` liệt kê route `/portal/shipments`, `/portal/debit-notes`, `/portal/statement` — 3 bề mặt, 0 case harness nào chạm tới.',
        ],
        evidence=[],
        ac=[
            '`testaccounts.txt` có khoá `CUSTOMER:` trong **cả** block `local:` và `staging:` (local: `samsung-cs, canon-cs`).',
            '`smoke.mjs` probe CUSTOMER và in OK với user thật trên **cả hai** môi trường (hoặc ghi rõ `local-only` nếu staging thật sự không có).',
            'Không còn case nào trong `testplan/qa/cases/` gặp lỗi "no username for role".',
            'Ít nhất một case portal khách hàng chạy được (ví dụ `/portal/shipments` mở ra và đọc được danh sách lô hàng của chính khách hàng đó — row-scoped).',
        ],
        verify=[
            'Trước: `node testplan/qa/scripts/smoke.mjs` không có dòng CUSTOMER; probe role CUSTOMER lỗi login.',
            'Sau: `node testplan/qa/scripts/smoke.mjs` có dòng `CUSTOMER … OK → <tên> [CUSTOMER]`.',
            'Xác minh row-scoping: đăng nhập `samsung-cs` → `/portal/shipments` chỉ thấy lô hàng của Samsung, không thấy lô của Canon.',
        ],
    ),
    dict(
        num='158',
        slug='dispatch-detail-filter-panel-covers-its-trigger',
        case_id='TC-FILTER-DROPDOWN-001',
        title='`/dispatch-detail`: bảng "Bộ lọc nhanh" **phủ đè lên chính nút đã bấm** ở 1024 và 1440',
        status='MỚI — phát hiện bởi ca QA 2026-09-28 (local dev)',
        source=(
            f'Ca QA toàn diện `testplan/` ngày 2026-09-28, mục **F-2** của báo cáo `{REPORT}`. '
            'Đo bằng `testplan/qa/scripts/ui-filter-audit-20260927.mjs`; xác nhận bằng probe chụp màn hình thật.'
        ),
        desc=[
            'Khi bấm "Bộ lọc" trên `/dispatch-detail` ở **1024** và **1440**, panel mở ra **phủ lên chính nút vừa bấm**, không neo dưới cũng không neo trên. Đây đúng là lỗi mà audit sinh ra để săn: *"why the dropdown jump around not right below where I clicked"*.',
            'Đo được: `overlaps: true`, `gapBelow: -137`, `gapAbove: -769`; panel cao 876px, mở ở `top: 12` trong khi nút nằm ở `top: 119`. Ở 390 panel là bottom-sheet đúng chuẩn, **không lỗi**.',
            'Đã xác nhận bằng mắt, không chỉ bằng số: ảnh chụp toàn viewport tại 1440 cho thấy sheet "Bộ lọc nhanh" tràn đè lên vị trí nút.',
            '**Cần CHIEF/phía sản phẩm ra lệnh trước khi sửa**: `/dispatch-detail` dùng một **sheet nhiều mục** (Bộ lọc nhanh · Giờ chạy và khu vực · Điểm giao nhận · Đội xe/rơ-moóc & tuyến · Cấu hình), khác với một dropdown nhỏ. Nên hoặc (a) neo panel dưới nút, hoặc (b) audit phải miễn trừ các panel dạng sheet. Hiện audit đang đỏ trên một bề mặt mà thiết kế có thể khác hẳn là hợp lệ.',
        ],
        facts=[
            'Audit: 125 thanh lọc đo được, **2 bị flag**, cả hai đều là `dispatch-detail` (1024 và 1440). 0 tràn, 0 control nằm ngoài thanh, 0 tràn trang.',
            'Các bề mặt còn lại (123/125) sạch hoàn toàn.',
            'Ở 390: panel là bottom-sheet đúng, không phủ nút.',
            'Card 20260927_151 đã gộp layout thanh lọc toàn app nhưng **không** đụng tới vấn đề neo panel này — đây là lỗi riêng.',
        ],
        evidence=[
            ('testplan/qa/evidence/20260928_humanqa_filter-audit/report.json',
             'report.json — 2 entry `flagged: true`, cùng surface `dispatch-detail`, 1024 + 1440'),
            ('testplan/qa/evidence/20260928_humanqa_filter-audit/dispatch-detail-1440-bar0.png',
             'Thanh lọc `/dispatch-detail` @1440 — nút "Bộ lọc" nằm cuối hàng đầu, sheet mở phủ lên chính nó'),
        ],
        ac=[
            'CHIEF/phía sản phẩm **ra lệnh rõ**: sheet phải neo dưới nút, hay audit miễn trừ panel dạng sheet. Không để lệnh chưa chốt mà sửa theo phỏng đoán.',
            'Nếu neo: panel không bao giờ phủ nút đã mở nó, ở **mọi** bề rộng 390/500/640/768/1024/1187/1440 (7 bề rộng trong audit).',
            'Nếu miễn trừ: audit ghi rõ điều kiện miễn trừ và **test** điều kiện đó, không tắt luôn L4.',
            'Đo lại: `0 flagged` trên toàn bộ sweep, hoặc chỉ còn đúng các case đã được miễn trừ có chủ đích.',
            'Không phá vỡ hành vi đã PASS của card 20260927_151: 2 hàng ở 1187, 0 hàng lẻ, 0 cắt chữ.',
        ],
        verify=[
            'Tái hiện: `make dev` → đăng nhập `dieuvan`/Abc123 → `/dispatch-detail` ở 1440×900 → bấm "Bộ lọc" → panel phủ nút.',
            'Chạy lại: `QA_BASE_URL=http://localhost:7175 node testplan/qa/scripts/ui-filter-audit-20260927.mjs` (mặc định 7 bề rộng) → đọc `report.json`.',
            'Kiểm tra không hồi quy: `cd frontend && npx vitest run src/components/filter-grid-rebuild.styles.test.ts src/pages/TripListPage.test.tsx` → xanh.',
        ],
    ),
    dict(
        num='159',
        slug='qa-cases-stale-selectors-and-assertions',
        case_id='TC-QA-CASE-001',
        title='11/14 verdict không-PASS của harness là **case hỏng**, không phải bug sản phẩm',
        status='MỚI — phát hiện bởi ca QA 2026-09-28',
        source=(
            f'Ca QA toàn diện `testplan/` ngày 2026-09-28, mục "Triage" của báo cáo `{REPORT}`. '
            'Mỗi case được đối chiếu với mã nguồn app và ảnh chụp của chính ca chạy đó.'
        ),
        desc=[
            '14 verdict FAIL/BLOCKED của harness, **không cái nào là bug sản phẩm**. 11 là tài sản test hỏng: selector cũ, chuỗi message cũ, assertion sai. Ba vấn đề có hệ thống bên dưới:',
            '**(1) Case tự mâu thuẫn với contract đã ship.** `TC-CUS-API-ERRCONTRACT-001` đòi message chứa `Trọng lượng phải là số không âm hợp lệ (cargoWeightKg)`, nhưng `backend/src/tests/validation-error-contract.test.ts:37-38` **khẳng định** chuỗi đã ship và **khẳng định nó không được chứa** `cargoWeightKg`. API thực tế trả `details: [{code, message, path:["cargoWeightKg"]}]` — đúng cái mà case định ghim. Case FAIL **trong khi sản phẩm đúng**.',
            '**(2) Selector cũ.** `TC-SHIP-SEARCH-001` tìm `input[placeholder*="Bill/Book"]`; ô tìm kiếm thật của `/shipments` là `placeholder: \'Bill, Book, Cont, Tờ khai...\'` + `ariaLabel: \'Tìm lô hàng\'` (`ShipmentsPage.tsx:490-491`).',
            '**(3) Topic không cách ly.** Ba case PASS của `chungtu-regression` mỗi case tạo một lô hàng; các lô đó (id 11192–11197, khách `CF khách <random>`) nằm **đầu danh sách** `/shipments`. Các case sau mở **dòng đầu tiên** nên gặp lô 0 container ⇒ `CusContainerLedger` render `cus-detail-empty` và **không có bảng nào** ⇒ `TC-SHIP-DRAWER-001` FAIL và `TC-CUS-APPOINTMENT-001` BLOCKED. Mọi assertion còn lại của drawer đều đạt.',
            '**(4) Thiếu nhánh BLOCKED.** `TC-SHIPMENTS-DETAIL-001` gõ fixture chỉ có trên staging (`QA0920-BL-RE`), lọc ra 0 dòng, không có nhánh "bộ lọc đã làm rỗng danh sách" nên kết luận FAIL.',
            '**(5) Rò rỉ chữ "staging".** Mọi case BLOCKED in ra "…on staging" **kể cả khi harness trỏ về local** — đọc như một tuyên bố về staging trong một ca chạy local.',
        ],
        facts=[
            '`TC-SHIP-QUICKEDIT-001`: bộ dò FCL thật ra là `td[data-label=\'Lịch trình & điều xe\'] div.cus-inline-trigger--readonly` — đó là ô **read-only**, không phải dấu hiệu FCL — nên nó bấm nhầm lô LCL và nhận modal thay vì điều hướng (đúng như thiết kế). Ảnh chụp cho thấy nó bấm `CF khách 1790257311484-ax74i5`.',
            'Cùng case, lỗi thứ hai: `fields === 0 ⇒ FAIL` là sai. `CusQuickEdit.tsx:30,51-53` chỉ render ô Bill/Booking khi IMPORT/EXPORT, ngược lại hiện dòng hướng dẫn "Chọn Nhập hoặc Xuất trong mục Phân loại trước khi cập nhập Bill/Booking." — ảnh chụp cho thấy modal render **đúng như thiết kế**.',
            'Tổng kết chạy: `chungtu-regression` 4 PASS/3 BLOCKED/1 FAIL · `dispatch-sweep` 4 PASS/1 BLOCKED/1 FAIL · `shipments-qa` 2 PASS/3 FAIL.',
        ],
        evidence=[
            ('testplan/qa/evidence/2026-09-27T17-34-00-210Z_89032_shipments-qa/05_03_quickedit_documents_open.png',
             'Modal "Chỉnh sửa Chứng từ" mở đúng, hiện hướng dẫn chọn Nhập/Xuất, 0 ô nhập — hành vi ĐÚNG, case FAIL sai'),
            ('testplan/qa/evidence/2026-09-27T17-34-00-210Z_89032_shipments-qa/03_02_fcl_identity_navigates.png',
             'Case "FCL" thực tế bấm lô LCL do chính ca trước tạo ra → mở modal, không điều hướng'),
        ],
        ac=[
            '`TC-CUS-API-ERRCONTRACT-001` khai đúng contract đã ship: message **không** kèm tên field, `details` là mảng có cấu trúc với `path: ["cargoWeightKg"]`, không có blob `[object Object]`.',
            '`TC-SHIP-SEARCH-001` bám selector thật (`ariaLabel: \'Tìm lô hàng\'`) và **không** hardcode fixture chỉ có trên staging.',
            'Các row-finder chọn theo **tính chất ổn định** (lô có container / có lịch hẹn), không chọn "dòng đầu tiên" — nên thứ tự chạy không còn ảnh hưởng kết quả.',
            '`TC-SHIP-QUICKEDIT-001` dò đúng hàng FCL, và coi modal không có ô nhập **đúng khi lô chưa có hình thức nhập/xuất** là hợp lệ (và kiểm tra dòng hướng dẫn có mặt).',
            '`TC-SHIPMENTS-DETAIL-001` có nhánh BLOCKED khi bộ lọc làm rỗng danh sách.',
            'Mọi message BLOCKED/FAIL nói đúng môi trường đang chạy, lấy từ `ctx.env.env` — không hardcode chữ "staging".',
            'Chạy lại cả 3 topic: verdict chỉ còn PASS và BLOCKED **có chủ đích**; không còn FAIL do selector/message cũ.',
        ],
        verify=[
            'Trước: `node testplan/qa/scripts/run-all.mjs shipments-qa` → 2 PASS · 3 FAIL, trong đó `TC-SHIP-SEARCH-001` lỗi "Search input not found".',
            'Sau: cùng lệnh → không còn FAIL nào do selector cũ; các case cần fixture staging phải BLOCKED **và** ghi rõ đang chạy local.',
            'Kiểm tra thứ tự: chạy `chungtu-regression` **trước** `shipments-qa` rồi chạy lại `shipments-qa` một mình → hai lần cho cùng kết quả.',
        ],
    ),
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
        f"`{card['case_id']}` — `{REPORT}` (báo cáo ca QA 2026-09-28). "
        'Chạy lại ca này (local + staging sau khi cut) trước khi chuyển card sang QA_PASSED.', '',
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
