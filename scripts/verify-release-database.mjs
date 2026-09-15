/** Read-only release evidence for KP024/KP026. Never repairs or marks history applied. */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postgres = createRequire(path.join(root, 'backend/package.json'))('postgres');
const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  const argument = index >= 0 ? args[index + 1] : undefined;
  return argument && !argument.startsWith('--') ? argument : undefined;
};
if (!value('--out') || !value('--environment') || !process.env.DATABASE_URL) {
  console.error('Usage: DATABASE_URL=... node scripts/verify-release-database.mjs --environment staging|production|local --out /persistent/evidence/report.json');
  process.exit(2);
}
const output = path.resolve(value('--out'));
const environment = value('--environment');
if (!['staging', 'production', 'local'].includes(environment)) throw new Error('Invalid environment label');
const drizzle = path.join(root, 'backend/drizzle');
const journal = JSON.parse(await readFile(path.join(drizzle, 'meta/_journal.json'), 'utf8'));
const expected = await Promise.all(journal.entries.map(async entry => ({
  index: entry.idx, tag: entry.tag, when: String(entry.when),
  hash: createHash('sha256').update(await readFile(path.join(drizzle, `${entry.tag}.sql`), 'utf8')).digest('hex'),
})));
const unjournaledFiles = (await readdir(drizzle)).filter(name => name.endsWith('.sql') && !expected.some(entry => `${entry.tag}.sql` === name));
const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10, idle_timeout: 10 });
const report = { environment, checkedAt: new Date().toISOString(), status: 'FAILED', unjournaledFiles };
try {
  Object.assign(report, await sql.begin('read only', async tx => {
    await tx`SET LOCAL statement_timeout = '30s'`;
    const applied = await tx`SELECT id, hash, created_at::text AS when FROM drizzle.__drizzle_migrations ORDER BY id`;
    const migrations = expected.map(entry => {
      const matches = applied.filter(row => row.when === entry.when && row.hash === entry.hash);
      const sameTime = applied.some(row => row.when === entry.when);
      return { ...entry, appliedCount: matches.length, status: matches.length === 1 ? 'MATCH' : matches.length > 1 ? 'DUPLICATE' : sameTime ? 'HASH_MISMATCH' : 'UNAPPLIED' };
    });
    const unexpectedHistory = applied.filter(row => !expected.some(entry => entry.when === row.when && entry.hash === row.hash));
    const foreignKeys = await tx`
      SELECT conname AS name, conrelid::regclass::text AS child, confrelid::regclass::text AS parent,
             pg_get_constraintdef(oid) AS definition, convalidated AS validated
      FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY conname`;
    const requiredKeys = {
      shipment_fulfillments_shipment_id_fkey: 'FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE',
      shipment_containers_shipment_id_fkey: 'FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE',
      trips_fulfillment_id_fkey: 'FOREIGN KEY (fulfillment_id) REFERENCES shipment_fulfillments(id) ON DELETE RESTRICT',
    };
    const missingForeignKeys = Object.entries(requiredKeys).filter(([name, definition]) => !foreignKeys.some(key => key.name === name && key.definition === definition && key.validated)).map(([name]) => name);
    const pairs = [
      ['shipment_fulfillments', 'shipment_id', 'shipments'], ['shipment_containers', 'shipment_id', 'shipments'],
      ['trips', 'shipment_id', 'shipments'], ['trips', 'fulfillment_id', 'shipment_fulfillments'],
      ['trip_containers', 'trip_id', 'trips'], ['trip_photos', 'trip_id', 'trips'],
      ['trip_photos', 'trip_container_id', 'trip_containers'], ['trip_financial_postings', 'trip_id', 'trips'],
      ['ledger', 'financial_posting_id', 'trip_financial_postings'],
    ];
    const orphanChecks = [];
    for (const [child, column, parent] of pairs) {
      // All identifiers are static above; no user-supplied SQL or mutation.
      const [row] = await tx.unsafe(`SELECT count(*)::integer AS count FROM ${child} c LEFT JOIN ${parent} p ON p.id = c.${column} WHERE c.${column} IS NOT NULL AND p.id IS NULL`);
      orphanChecks.push({ child, column, parent, count: row.count });
    }
    const penaltyColumns = await tx`SELECT column_name, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'penalties' ORDER BY ordinal_position`;
    const penaltySupersession = {
      initialApplied: migrations.some(row => row.tag === '0080_penalty_approval_workflow' && row.status === 'MATCH'),
      revertApplied: migrations.some(row => row.tag === '0081_penalty_workflow_revert' && row.status === 'MATCH'),
      retiredColumnsPresent: penaltyColumns.filter(row => ['created_by', 'approved_by', 'approved_at'].includes(row.column_name)).map(row => row.column_name),
      statusDefault: penaltyColumns.find(row => row.column_name === 'status')?.column_default,
    };
    return { migrations, unexpectedHistory, foreignKeys, missingForeignKeys, orphanChecks, penaltySupersession };
  }));
  // Historical 0038/0039 share a timestamp; each must match its own SQL hash.
  const journalOrderValid = expected.every((entry, index) => entry.index === index && (!index || Number(entry.when) >= Number(expected[index - 1].when)));
  report.journalOrderValid = journalOrderValid;
  report.unexplainedFiles = unjournaledFiles.filter(name => name !== '0064_cynical_eddie_brock.sql'
    || !report.migrations.some(row => row.tag === '0086_restore_missing_pricing_schema' && row.status === 'MATCH'));
  report.status = journalOrderValid && report.migrations.every(row => row.status === 'MATCH')
    && !report.unexplainedFiles.length && !report.unexpectedHistory.length && !report.missingForeignKeys.length
    && report.orphanChecks.every(row => row.count === 0)
    && report.penaltySupersession.revertApplied && !report.penaltySupersession.retiredColumnsPresent.length
    && report.penaltySupersession.statusDefault?.includes('ACTIVE') ? 'PASS' : 'FAILED';
  // Unjournaled historical files require a disposition, never fabricated DB rows.
  report.note = 'Review unjournaledFiles explicitly. The historical pricing DDL omitted from the old journal is restored by 0086_restore_missing_pricing_schema; it must not be inserted retrospectively into applied history.';
} catch (error) {
  // Do not serialize connection options, SQL parameters, or connection URLs.
  report.error = { name: error.name, code: error.code ?? null };
} finally {
  await sql.end({ timeout: 5 });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}
console.log(`${report.status}: ${output}`);
process.exitCode = report.status === 'PASS' ? 0 : 1;
