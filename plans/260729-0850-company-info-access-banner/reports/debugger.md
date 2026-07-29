# Company-Info Access + Dashboard Banner Regression Check

## Executive Summary
- **Issue:** Review current `company-info` access + dashboard banner worktree diff for real regressions in route guard, governance, caching, and banner behavior.
- **Impact:** 1 confirmed functional defect in the banner authority path; 1 confirmed false-signal test/route change.
- **Root cause:** frontend uses `updatedAt` as the sole “configured” authority, but backend seed/bootstrap creates blank `company.*` rows with non-null `updatedAt`.
- **Status:** Investigation complete. No product code changed.
- **Fix direction:** change “configured” detection to content-based or seed-state-aware authority; do not rely on `updatedAt` alone.

## Timeline
- **08:49** Read repo contract, context, handoff, current diff, and task-local files.
- **08:53** Traced frontend guard semantics and found `adminOnly` already admits `MANAGER` and `ACCOUNTANT`.
- **08:55** Traced backend `/api/company-info` PUT path through idempotency + governed action request + approval policy.
- **08:57** Verified frontend tests and focused backend RBAC test pass.
- **08:58** Correlated banner/config `updatedAt` logic with seed/bootstrap path.
- **08:59** Reproduced `companyInfoFromSettings()` with seeded blank rows; confirmed non-null `updatedAt` for blank company info.

## Findings

### 1. Confirmed defect: company-info setup banner is unreachable on seeded installs
- **Severity:** High
- **Evidence chain:**
  - Banner renders only when `companyInfo.updatedAt` is falsy: [frontend/src/features/dashboard/components/CompanyInfoSetupBanner.tsx](/Users/dev/Documents/projects/silversea/frontend/src/features/dashboard/components/CompanyInfoSetupBanner.tsx:6)
    - guard is `if (!companyInfo || companyInfo.updatedAt) return null;` at lines 7-9.
  - Config page uses the same authority: [frontend/src/pages/ConfigPage.tsx](/Users/dev/Documents/projects/silversea/frontend/src/pages/ConfigPage.tsx:99)
    - returns `Đã cấu hình` whenever `companyInfo.data?.updatedAt` exists at lines 99-104.
  - Backend seed inserts blank `company.*` rows on setup: [backend/src/seed.ts](/Users/dev/Documents/projects/silversea/backend/src/seed.ts:460)
    - lines 465-468 insert one `app_settings` row per company-info field even before any user save.
  - `app_settings.updated_at` is `defaultNow().notNull()`: [backend/src/db/schema.ts](/Users/dev/Documents/projects/silversea/backend/src/db/schema.ts:1741)
    - line 1745 guarantees seeded rows get `updatedAt`.
  - `companyInfoFromSettings()` always promotes any present row timestamp into response `updatedAt`: [backend/src/services/company-info.service.ts](/Users/dev/Documents/projects/silversea/backend/src/services/company-info.service.ts:64)
    - lines 71-81 compute max row timestamp and serialize it.
  - Local reproduction:
    - `cd backend && npx tsx -e "import { companyInfoFromSettings, COMPANY_INFO_SETTING_KEYS } from './src/services/company-info.service.ts'; const now=new Date('2026-07-29T00:00:00Z'); const rows=Object.values(COMPANY_INFO_SETTING_KEYS).map((key)=>({key,value:'',updatedAt:now})); console.log(JSON.stringify(companyInfoFromSettings(rows), null, 2));"`
    - output contained all-empty fields plus `"updatedAt": "2026-07-29T00:00:00.000Z"`.
- **Conclusion:** on normal seeded environments, blank company info already looks “configured” to the frontend. The new banner and config status can stay hidden/green before any real company profile exists.

### 2. Confirmed false-signal change: route-guard diff does not actually expand access
- **Severity:** Medium
- **Evidence chain:**
  - `adminOnly` is not admin-only. It only blocks portal/customer/clerk roles: [frontend/src/App.tsx](/Users/dev/Documents/projects/silversea/frontend/src/App.tsx:144)
    - line 144 admits any office staff role, including `MANAGER` and `ACCOUNTANT`.
  - `officeStaffOnly` admits `ADMIN`, `MANAGER`, `ACCOUNTANT`: same file, lines 148-150.
  - Therefore changing `/config/company-info` from `adminOnly(...)` to `officeStaffOnly(...)` does not change `MANAGER`/`ACCOUNTANT` behavior: same file, line 228.
  - The new route test only asserts current access for office roles: [frontend/src/App.company-info-route.test.tsx](/Users/dev/Documents/projects/silversea/frontend/src/App.company-info-route.test.tsx:58)
    - lines 63-69 pass under both guards because both already admit those roles.
- **Conclusion:** the diff suggests an RBAC expansion, but in current frontend semantics it is a no-op. The added test gives false confidence because it would have passed before the route change.

## Eliminated Hypotheses

### Backend write path bypasses governance for MANAGER / ACCOUNTANT
- **Result:** Eliminated.
- **Evidence:**
  - `PUT /api/company-info` does not write directly. It requires idempotency, reads expected version, then creates a governed config action: [backend/src/routes/config.ts](/Users/dev/Documents/projects/silversea/backend/src/routes/config.ts:1405)
    - lines 1417-1432 call `requestGovernedConfigAction(...)`.
  - Company-info uses `PRICE_CONFIG_CHANGE` governance policy: [backend/src/services/governance-policy.ts](/Users/dev/Documents/projects/silversea/backend/src/services/governance-policy.ts:321)
    - maker=`GOVERNANCE_CREATE`, checker=`FINANCE_CHECK`, approver=`PRICE_APPROVE`.
  - Role capabilities: `ACCOUNTANT` has `GOVERNANCE_CREATE` and `FINANCE_CHECK`, but not `PRICE_APPROVE`; `ADMIN`/`MANAGER` do have `PRICE_APPROVE`: same file, lines 27-46.
  - Self-check and self-approve are blocked: same file, lines 531-548.
  - Focused backend test passed: `cd backend && npx tsx --test src/tests/company-info-rbac.test.ts`.
- **Conclusion:** maker-checker-governance is preserved; the diff does not open a direct write bypass.

### Approval path fails to invalidate cached company-info after governance approval
- **Result:** Eliminated.
- **Evidence:**
  - On approval success, frontend invalidates governance list; for `subjectKey === 'company-info'` it also invalidates `qk.catalogs.companyInfo` and `qk.configCounts.companyInfo`: [frontend/src/hooks/useFinancialQueries.ts](/Users/dev/Documents/projects/silversea/frontend/src/hooks/useFinancialQueries.ts:42)
    - lines 49-55.
  - Backend creates company-info governance actions with `subjectKey: 'company-info'`: [backend/src/routes/config.ts](/Users/dev/Documents/projects/silversea/backend/src/routes/config.ts:1424)
    - line 1428.
- **Conclusion:** cache invalidation after approval is wired correctly for the company-info key.

## Test Evidence
- `pnpm --dir frontend test --run App.company-info-route.test.tsx src/features/dashboard/components/CompanyInfoSetupBanner.test.tsx`
  - passed: 2 files, 7 tests.
- `cd backend && npx tsx --test src/tests/company-info-rbac.test.ts`
  - passed: 1 suite, 2 tests.
- An attempted `pnpm --dir backend test -- company-info-rbac.test.ts` was interrupted because the package script fans out into the entire backend test suite; not used as evidence.

## Recommendations

### Immediate
- Change “configured company info” authority away from `updatedAt` alone.
  - safest options:
    - treat seeded blank/default rows as unconfigured in backend GET/derived state, or
    - compute configured-ness from required non-empty business fields (`name`, `address`, `taxCode`, representative/contact/bank fields), not row existence.
- Rewrite the banner test to exercise a realistic seeded-blank response (`updatedAt` present, required fields empty). Current test fixture at [frontend/src/features/dashboard/components/CompanyInfoSetupBanner.test.tsx](/Users/dev/Documents/projects/silversea/frontend/src/features/dashboard/components/CompanyInfoSetupBanner.test.tsx:12) does not match seeded reality.

### Short-term
- Rename or replace `adminOnly` to reflect actual semantics. Current name invites incorrect RBAC changes and tests.
- Add a route-guard regression test that distinguishes `adminOnly`, `officeStaffOnly`, and `strictAdminOnly` behavior instead of only asserting allowed office roles.

### Long-term
- Centralize “singleton config readiness” authority in one backend-derived field or shared helper so dashboard, config cards, and exports do not infer readiness differently.

## Unresolved Questions
- If product intent is “show the banner only on truly brand-new databases without seeded rows,” then the current bug is masked by seed strategy and the authority needs an explicit readiness contract.
- `CompanyInfoSetupBanner` currently hides on request error as well as missing data because it only inspects `data`; this review did not prove whether silent failure is desired UX.

Status: DONE
Summary: Two concrete issues found. The banner’s configured-state authority is wrong on seeded installs, and the route-guard diff is a semantic no-op with a misleading test.
Concerns/Blockers: None for the read-only investigation. Product code unchanged.
