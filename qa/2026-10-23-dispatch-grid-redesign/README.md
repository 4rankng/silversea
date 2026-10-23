# QA — Redesign grid Điều vận Chi tiết (owner screenshots 23/10)

Case: `testplan/2026-10-23-dispatch-grid-redesign.md` (R1–R4).
Driver: `qa/scripts/2026-10-23-dispatch-grid-redesign.mjs`
(env-only ports per dev-port-contract: `QA_FRONT`, `QA_API`, `QA_PHASE`).

- **BEFORE** = main checkout build (`http://localhost:7175`, same commit
  2425726d = pre-change UI).
- **AFTER** = this worktree's build (`http://localhost:7182`, Vite proxy →
  BE `:3002`, DB `:5441` ss-prod-db mirror).
- Role: DISPATCHER (`dungnv` NV015 — the mirror has no `dieuvan` demo
  account). Date scope widened to "Tất cả" in-driver so the 17/10 fixture
  lots render; 50 rows on the board for every capture.
- Token injected via `localStorage.setItem('token')` before SPA navigation
  (`puppeteer-spa-auth` pattern).

## Results

| Phase | Rung | Log | Screenshots |
|---|---|---|---|
| BEFORE | UI DRIVEN | `dispatch-grid_before_ui-driver.log` | `before_grid-390.png` `before_grid-768.png` `before_grid-1440-full-left.png` |
| AFTER  | UI DRIVEN | `dispatch-grid_after_ui-driver.log` (20/20 PASS, exit 0) | `after_grid-390.png` `after_card-menu-open-390.png` `after_grid-768.png` `after_grid-1440-full-left.png` `after_grid-1440-scrolled-right.png` |

### Owner defects → measurements (before → after, real local data)

| Defect (owner screenshot 23/10) | Before | After |
|---|---|---|
| Row ~230px, 70% trống (768 desktop-wide) | rows 242–502px @390/768, 101px @1440 | rows 70–93px @768/1440 |
| SĐT wrap từng ký tự ("0984/9634/84" 3 dòng) | `driver-phone` 46px (3 lines) @1440 | 15px one line @768/1440; card line `15E-019.80 · Nguyễn Huy Vương · 0984963484` 17px `nowrap` @390 |
| 4 nút inline tràn lan (⋯ xanh + Xóa lô ĐỎ + Sửa + Ghép) | 50 nút Xóa lô đỏ inline + 50 ⋯ + 50 Sửa + Ghép | 0 inline delete; mọi verb trong menu ⋯ (cột pin phải trên table; 40px trigger trên card) |
| Cột Nâng/Trả cắt cụt ("Cả…", "Bãi…") | bảng ép 374px @390 | table ≥640px với min-width 1340px, scroll TRONG container (`sw=1340/cw=744` @768), không page overflow (`overflowX=0`) |
| Cột phình Thời gian/Khách hàng | 17% + 17.5% shares | 10.3% + 13.6%; floors: route 182px, assignment 202px, notes 162px @1340 |
| Menu ⋯ card mobile | — | items `["Phân xe lại","Ghép chuyến","Xóa lô"]` (dòng issued → label Phân xe lại đúng luật), Xóa lô LAST + danger, ảnh `after_card-menu-open-390.png` |
| Sticky header + actions khi scroll | — | `after_grid-1440-scrolled-right.png`: cột Thao tác pinned trong khi rail scroll (PASS sticky-visible) |

### Persisted-state identity (§9.3 — read-only restructure)

`dispatch-grid_after_db-identity.json`: `select count(*), max(updated_at) from shipments`
before == after (`n=186`, last `2026-10-22 21:17:00.489684`) — the UI session
mutated nothing.

## Not covered

- Role sweep khác (ADMIN/CUS/ACCOUNTANT trên màn này) — scoped fix, role law
  không đổi (menu Xóa lô vẫn qua page guard CUS/ADMIN như test
  `DispatchDetailPlanPage.delete-lot.test.tsx`).
- Master plan /dispatch (khác surface — MasterPlanGrid riêng).
- Staging (owner NEVER per law).
- Error/rollback path của Xóa lô confirm dialog (page-owned, phủ bởi unit
  tests FB095-UI-06b; UI driver không bấm thật để không đụng data dùng chung).
- Driver không verify journal/keyboard nav menu (Tab/Arrow) — menu dùng đúng
  house dismissal layer như các menu khác.
