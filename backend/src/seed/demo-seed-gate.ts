/**
 * FB-061 (card 141026012010 re-report): the demo seed must never write
 * production rows.
 *
 * History: staging surfaces repeatedly showed self-authored seed rows
 * (invoice-tracking card-376 cleanup, 2026-10-08) because nothing stopped
 * a demo seeder from running against a production database.
 *
 * The 2026-10-14 fix gated `pnpm seed` (src/seed.ts) only. That left the
 * defect class open: `src/seed-dashboard.ts` is a second, independently
 * runnable demo seeder (`npx tsx src/seed-dashboard.ts`) that inserts trips,
 * ledger entries and expenses — exactly the self-authored rows this gate
 * exists to prevent — with no production check at all. One owner now lives
 * here so every demo seeder shares one law; each entrypoint calls it before
 * its first write.
 *
 * The gate refuses NODE_ENV=production unless SEED_DEMO_DATA explicitly opts
 * in (true/1/yes, mirroring the config parseFlag law — "false"/"0"/"no" are
 * non-empty strings a naive boolean parse would treat as enabled). Dev/test
 * environments are unaffected. Production master data comes from
 * `pnpm seed:prod` (seed/seed-prod.ts — master data only, no demo rows).
 */
export function demoSeedBlocked(env: NodeJS.ProcessEnv = process.env): string | null {
  const flag = env.SEED_DEMO_DATA;
  const explicitlyAllowed = flag === 'true' || flag === '1' || flag === 'yes';
  if (env.NODE_ENV === 'production' && !explicitlyAllowed) {
    return [
      'Từ chối seed demo: NODE_ENV=production và không có SEED_DEMO_DATA.',
      'Bộ dữ liệu demo (tài khoản demo, xe 60C-*, lô/chuyến mẫu, bulk rows, AR/AP fixtures) không bao giờ được ghi vào database production.',
      'Production dùng `pnpm seed:prod` (backend/src/seed/seed-prod.ts — master data only).',
      'Cần seed demo lên server demo production-shaped một cách có chủ đích? Đặt SEED_DEMO_DATA=true.',
    ].join(' ');
  }
  return null;
}