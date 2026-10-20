# Case QA-2026-10-20-pwa-standalone-footer — PWA installed vẫn hiện footer © login (web chrome trong native shell)

## Report (user, verbatim 20/10)

"web-app đã cài mà sao còn hiện footer kiểu website" — PWA cài lên iPhone
(Share → Add to Home Screen), mở từ icon Home Screen, login vẫn hiện footer
"© 2026 Ting Ting Software Solution". Installed app phải cảm giác native:
không có decoration web.

## Root cause (pre-fix)

Login footer là thứ duy nhất render `BRAND.legalEntity` (grep `©|legalEntity`
cả frontend — không trang in-app nào có footer tương tự). Cơ chế ẩn nếu có
chỉ dựa `@media (display-mode: standalone)` — không đáng tin trên iOS WebKit:
evaluate `false` cho home-screen web app dù đang chạy standalone. iOS expose
`navigator.standalone === true` (legacy flag), và flag này có thể `undefined`
vài chục ms đầu sau launch.

## Expected

1. Installed (Home Screen launch): footer © login + marketing hero copy
   ("Mọi hoạt động. Một hệ thống." + capabilities) BỊ ẨN.
2. Browser thường (web visitor): cả hai VẪN HIỆN — branding giữ nguyên.
3. Home-indicator clearance trên iPhone không mất khi footer (carrier cũ của
   `env(safe-area-inset-bottom)`) biến mất.

## Fix (hybrid, per research webchat — DeepSeek iOS PWA)

- `frontend/src/lib/pwa-standalone.ts`: `isPwaStandalone()` =
  `navigator.standalone === true || matchMedia('(display-mode: standalone)')`;
  `watchPwaStandalone()` apply class `pwa-standalone` lên `<html>` với retry
  50/250/1000ms + listener display-mode change. Cài qua `PwaStandaloneMarker`
  (useEffect) trong `App.tsx`, cạnh `SessionNoticeToaster`.
- `styles/utilities.css`: `.pwa-standalone .hide-in-pwa { display:none !important }`
  + belt-and-braces `@media all and (display-mode: standalone)`.
- `LoginPage.tsx`: footer + `.login-visual__content` mang `hide-in-pwa`;
  aside đổi `aria-labelledby` → `aria-label` (heading ẩn làm reference
  dangling). `LoginPage.css`: `.pwa-standalone .login-auth-panel
  { padding-bottom: env(safe-area-inset-bottom) }` giữ clearance.
- index.html đã đủ sẵn từ trước: `viewport-fit=cover`, `theme-color`,
  `apple-mobile-web-app-status-bar-style=black-translucent`; manifest
  `display: standalone` ✓ — không đổi.

## Verification (rung per §9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| iOS branch: standalone=true (media false) → footer + hero copy display:none, html có class | UI DRIVEN (Chrome thật, cascade computed-style) | `qa/2026-10-20-pwa-standalone/ui-standalone-hide.png`, `ui-driver.log` [A] (`matchMedia=false`, `footer display=none`), exit file | iPhone WebKit thật (cùng code path, khác engine) |
| Browser thường → footer flex, hero hiện, không class | UI DRIVEN | `ui-browser-footer.png`, `ui-driver.log` [B] | — |
| matchMedia-only branch (Android/desktop installed) | UI DRIVEN nếu CDP hỗ trợ emulate display-mode, không thì UNIT ONLY | `ui-driver.log` [C] hoặc `src/lib/pwa-standalone.test.ts` | Android Chrome thật |
| CSS contract (rule scoped đúng, không hide vô điều kiện) | CODE-READ + source assertion | `src/styles/pwa-standalone.styles.test.ts` (4 tests) | — |
| DB side-effect | N/A — read-only surface | `ui-driver.log` [DB] mutating=0 | — |

## ⚠️ User action sau deploy

iOS snapshot MANIFEST LÚC INSTALL — PWA đã cài trên máy user giữ nguyên
behavior cũ. Sau khi deploy build mới: **xóa icon Home Screen cũ → mở Safari
→ Add to Home Screen LẠI** mới nhận được behavior mới.

## Gates

- FE typecheck `npx tsc -b` 0 (repo không có `tsgo` — npx 404; gate chuẩn §5).
- Scoped vitest: lib 6 + LoginPage.pwa 4 + styles contract 4 + LoginPage hiện
  có 14 + App.* 72 = 100/100 pass (16 files).
- `pnpm lint` 0 errors 0 warnings.
- "1 unhandled rejection" trong combined run là pre-existing (A/B stash: tree
  sạch cũng đúng 1 error, `App.nav-sweep` lazy-chunk teardown race; file vẫn
  7/7 pass cả hai tree) — không phải của fix.
