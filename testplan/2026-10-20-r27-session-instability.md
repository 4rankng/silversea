# R27 — Staging session instability: phiên tự rớt + tự chuyển user (env note QA R27)

- Card: `20261020_r27-session-instability`
- Source: QA R27 environment note (verbatim): "Phiên đăng nhập staging tự rớt sau vài
  phút và thỉnh thoảng tự chuyển sang người dùng khác; mọi kết quả đều được kiểm tra
  lại sau khi đăng nhập lại đúng vai trò."
- Severity: nghiêm trọng — user-mixing khiến QA có thể test SAI ROLE → FAIL "ma"
  (nghi ngờ nguồn một phần các standing ticket).

## Root cause (điều tra 2026-10-20)

Kiến trúc: JWT stateless (`JWT_EXPIRES_IN` mặc định `7d` — `backend/src/config/index.ts`),
login trả token trong body, SPA lưu **một key duy nhất** `localStorage['token']`
(`frontend/src/lib/token.ts`). Không cookie, không refresh endpoint, không server
session store; blacklist logout trong Redis dùng chung (1 instance); nginx không
cache `/api`; mỗi môi trường 1 backend instance → **không có** TTL ngắn, không có
proxy cache auth, không có multi-worker in-memory session.

Cả 2 triệu chứng đều thuộc lớp **shared-token multi-tab** (QA mở nhiều tab nhiều
role trong cùng 1 browser profile):

1. **Tự chuyển user** — tab 2 đăng nhập role B ghi đè key chung → tab 1 (đang role A)
   nhận storage event → `syncStoredSession` đổi thân phận tab 1 sang B **im lặng**
   (không thông báo). Giữa 2 lúc đó mọi request của tab 1 đã mang token B trong khi
   UI còn hiển thị A → kết quả test sai role. Ngoài ra `/auth/me` có `staleTime` 5
   phút nên tab nền đổi user trễ "sau vài phút" — khớp mô tả QA.
2. **Tự rớt phiên** — (a) logout/đổi mật khẩu ở BẤT KỲ tab nào thu hồi token dùng
   chung server-side (`POST /auth/logout` → Redis blacklist) → các tab khác 401 ở
   request kế tiếp → rớt về login; (b) `authMiddleware` revalidate role/status/
   customer-scope theo DB mỗi request — admin tab sửa user đang test ở tab khác
   (thường gặp khi QA multi-role) → 401 "Quyền tài khoản đã thay đổi".

## Regression cases

### TC-1 — cross-tab identity swap phải LOUD (không còn im lặng)
1. Chạy frontend (build có fix), login `admin` ở tab 1, đợi shell render.
2. Tab 2 (cùng browser profile) login `hoapt` (ACCOUNTANT).
3. **Expected**: tab 1 HIỂN THỊ toast warning "Thẻ khác đã đăng nhập — phiên này
   chuyển sang <tên> (<vai trò>)…" và thân phận tab 1 trở thành hoapt; KHÔNG còn
   chuyển user im lặng. (Trước fix: không có bất kỳ tín hiệu nào.)

### TC-2 — cross-tab logout có thông báo lý do
1. Login `admin` tab 1; tab 2 login `hoapt` (tab 1 sync sang hoapt).
2. Tab 2 bấm Đăng xuất.
3. **Expected**: tab 1 hiển thị toast "Phiên đăng nhập đã kết thúc ở thẻ khác."
   rồi về màn hình login (hành vi rớt là đúng theo thiết kế 1 token dùng chung;
   phần fix là **nêu rõ lý do** thay vì rớt vô cớ). Server log có dòng
   `[Auth] reject reason=revoked` khi token bị thu hồi.

### TC-3 — same-user re-login KHÔNG toast
1. Login `admin` tab 1; tab 2 login lại `admin` (token mới, cùng userId).
2. **Expected**: không có toast đổi thân phận (chỉ đổi token).

### TC-4 — single-session ổn định (không tự rớt khi chỉ 1 phiên)
1. Probe `qa/scripts/session-stability-probe.sh`: login 2 user (2 phiên curl
   riêng), poll `GET /api/auth/me` 60s/lần ≥10 phút.
2. **Expected**: cả 2 phiên giữ nguyên userId/role, HTTP 200 xuyên suốt, 0 lần 401,
   0 lần đổi danh tính. `/api/health` báo `authTokenTtlSeconds` = TTL thật của môi
   trường (staging `7d` = 604800) — một curl trả lời "TTL có ngắn không?".

## Fix (commit này)
- FE: session identity event bus (`lib/api/session.ts`) + notify trong
  `syncStoredSession` (`useAuth.tsx`) + `SessionNoticeToaster` (`App.tsx`).
- BE: `/api/health` thêm `authTokenTtlSeconds`; `authenticateToken` log lý do
  reject (`reason=revoked|expired|role-drift|scope-drift`) để chẩn đoán từ server log.
- KHÔNG đổi: vẫn 1 token dùng chung (chuẩn owner ruling — cấm sessionStorage
  per-tab / cookie per-role); QA multi-role phải dùng profile/incognito riêng
  (xem HANDOFF mục QA multi-role).

## QA multi-role procedure (đi kèm fix)
- Mỗi role = 1 cửa sổ riêng: Chrome profile riêng hoặc incognito window riêng.
  KHÔNG mở 2 role trong cùng profile ở các tab thường — token dùng chung sẽ
  ghi đè lẫn nhau (đó là hành vi chuẩn của thiết kế 1 session/browser).
- Sau khi admin sửa user (role/trạng thái/gán khách): user đó đăng nhập lại —
  401 "Quyền tài khoản đã thay đổi" là chủ đích bảo mật.
- Khi thấy toast "Thẻ khác đã đăng nhập" — tab đó ĐANG là tài khoản khác: dừng
  test, kiểm tra lại role trước khi ghi kết quả (chống FAIL ma).
