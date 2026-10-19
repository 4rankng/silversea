// One-shot residue sweep for the full-guide QA wave (2026-10-17): deletes the
// QA-prefixed lots a driver run may leave behind (governed DELETE with the
// optimistic-lock version) and reports the QA rows whose only sanctioned cleanup
// path is the registry purge (`make qapurge`) — the deposit tracker and the
// advance tables have no delete route at all.
//
// Usage: EXPECT_BUILD=<hash> node testplan/qa/scripts/2026-10-17-manual-residue-cleanup.mjs
import { makeLogger, healthGate, login, api, psql } from './fullguide-lib.mjs';

const logger = makeLogger('manual-residue');
const { step } = logger;
await healthGate(logger);

const admin = await login('admin');
if (!admin.token) throw new Error('admin login failed');

const PREFIXES = ['QA-FG16-%', 'QA-MAN-A1-%'];
const listSql = `SELECT s.id || '|' || s.booking_ref || '|' || coalesce(s.version, 0) FROM shipments s WHERE s.deleted_at IS NULL AND (${PREFIXES.map((p) => `s.booking_ref LIKE '${p}'`).join(' OR ')}) ORDER BY s.id`;
const rows = psql(listSql).split('\n').filter(Boolean);
step('residue-lots', { rows });
for (const row of rows) {
  const [id, ref, version] = row.split('|');
  const del = await api(admin.token, 'DELETE', `/shipments/${id}`, { version: Number(version), reason: 'QA cleanup 2026-10-17 manual verification residue' });
  step('delete-lot', { id, ref, version, status: del.status, body: del.text?.slice(0, 120) });
}

const stillLots = psql(`SELECT count(*) FROM shipments WHERE deleted_at IS NULL AND (${PREFIXES.map((p) => `booking_ref LIKE '${p}'`).join(' OR ')})`);
const qaExpenses = psql("SELECT count(*) FROM ops_expense_entries WHERE (note ILIKE '%QA manual%' OR note ILIKE '%QA fullguide%') AND approval_status <> 'VOIDED'");
// These two surfaces have NO API delete route (accounting-deposit.ts exposes
// create / dates / refund only), so their QA rows are left to the sanctioned
// registry purge (`make qapurge`: deposit_refund_trackers, advance_requests).
const qaDeposits = psql("SELECT coalesce(string_agg(id || ':' || bill_number || ':' || deposit_amount, ', '), 'none') FROM deposit_refund_trackers WHERE note ILIKE '%QA%'");
const qaAdvances = psql("SELECT coalesce(string_agg(id || ':' || amount || ':' || status, ', '), 'none') FROM advance_requests WHERE reason ILIKE 'QA%'");
step('residue-after', { stillLots, qaExpenses, qaDeposits, qaAdvances });
console.log(`\n=== residue: lots=${stillLots} qaOpsExpenses=${qaExpenses} qaDeposits=[${qaDeposits}] qaAdvances=[${qaAdvances}]`);
