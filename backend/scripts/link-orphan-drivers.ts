/**
 * Link orphan driver profiles to existing user accounts.
 *
 * After driver management merged into /users, driver rows created before the
 * merge have user_id IS NULL. This script LINKS them to existing matching user
 * accounts (by full name → username → phone) instead of creating new logins —
 * avoiding duplicate accounts and default passwords.
 *
 * Usage:
 *   npx tsx scripts/link-orphan-drivers.ts           # Dry-run (default) — prints plan, writes nothing
 *   npx tsx scripts/link-orphan-drivers.ts --apply   # Perform the links
 *
 * Idempotent: re-running finds 0 linkable orphans. Each link is its own UPDATE
 * guarded by `user_id IS NULL`, so a concurrent run cannot double-link. A user
 * that already owns a driver profile is never given a second one.
 */
import { db } from '../src/db';
import * as s from '../src/db/schema';
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';

const APPLY = process.argv.includes('--apply');
const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();

type UserLite = {
  id: number;
  role: string;
  fullName: string | null;
  username: string | null;
  phone: string | null;
};

async function main() {
  console.log(`\n🔗 Link orphan drivers → users  (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`);

  const orphans = await db.select({
    id: s.drivers.id,
    name: s.drivers.name,
    phone: s.drivers.phone,
  })
    .from(s.drivers)
    .where(and(isNull(s.drivers.userId), isNull(s.drivers.deletedAt)));

  if (orphans.length === 0) {
    console.log('✅ No orphan drivers found. Nothing to do.\n');
    return;
  }

  // Load all live users once and match in memory (case/whitespace-insensitive).
  const users: UserLite[] = await db.select({
    id: s.users.id,
    role: s.users.role,
    fullName: s.users.fullName,
    username: s.users.username,
    phone: s.users.phone,
  })
    .from(s.users)
    .where(isNull(s.users.deletedAt));

  // Users that already own a (non-deleted) driver profile — never attach a second.
  const taken = new Set<number>(
    (await db.select({ userId: s.drivers.userId })
      .from(s.drivers)
      .where(and(isNotNull(s.drivers.userId), isNull(s.drivers.deletedAt))))
      .map(r => r.userId as number),
  );

  const pick = (pred: (u: UserLite) => boolean): UserLite | null => {
    const cs = users.filter(pred);
    if (cs.length === 0) return null;
    return cs.find(u => u.role === Role.DRIVER) ?? cs[0]; // prefer DRIVER role
  };

  const matchUser = (o: typeof orphans[number]): { user: UserLite; via: string } | null => {
    const target = norm(o.name);
    if (target) {
      let u = pick(u => norm(u.fullName) === target);
      if (u) return { user: u, via: 'full_name' };
      u = pick(u => norm(u.username) === target);
      if (u) return { user: u, via: 'username' };
    }
    if (o.phone) {
      const p = norm(o.phone);
      const u = pick(u => norm(u.phone) === p);
      if (u) return { user: u, via: 'phone' };
    }
    return null;
  };

  let byName = 0, byUsername = 0, byPhone = 0, unmatched = 0, skipped = 0;

  for (const o of orphans) {
    const m = matchUser(o);
    if (!m) {
      console.log(`  ⚠️  #${o.id} "${o.name}" — no matching user (manual review)`);
      unmatched++;
      continue;
    }
    if (taken.has(m.user.id)) {
      console.log(`  ⊘  #${o.id} "${o.name}" → user #${m.user.id} already linked to another driver (skipped)`);
      skipped++;
      continue;
    }

    console.log(
      `  ${APPLY ? '🔗' : '·'}  #${o.id} "${o.name}" → user #${m.user.id} ` +
      `(${m.user.fullName ?? m.user.username ?? '?'}, role=${m.user.role}) via ${m.via}`,
    );

    if (APPLY) {
      await db.update(s.drivers)
        .set({ userId: m.user.id, updatedAt: sql`now()` })
        .where(and(eq(s.drivers.id, o.id), isNull(s.drivers.userId)));
      taken.add(m.user.id); // prevent chaining two orphans to the same user within this run
    }

    if (m.via === 'full_name') byName++;
    else if (m.via === 'username') byUsername++;
    else byPhone++;
  }

  console.log(
    `\n📊 ${orphans.length} orphans · ${byName} name · ${byUsername} username · ${byPhone} phone · ${skipped} skipped · ${unmatched} unmatched`,
  );
  if (!APPLY) console.log('Dry-run only — re-run with --apply to perform the links.\n');
  else console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
