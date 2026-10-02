// testplan/qa/lib/case-registration.test.mjs — every case file must be
// registered in its topic's index.mjs.
//
// Card 20260928_155: `dispatch-sweep-2026-09-09/` held 9 case files while its
// index.mjs declared 6, so `run-all.mjs` silently executed 6. One of the
// orphans (TC-DV-DISPATCH-051) PASSES when run by hand — meaning a topic could
// report a plausible green line while never running a test that would have
// caught a regression.
//
// This is a deletion tripwire, in the same spirit as the drizzle journal's
// `minCount` floor: adding a case file without registering it fails the QA
// gate instead of quietly shrinking coverage.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CASES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../cases');

const topics = fs
  .readdirSync(CASES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test('the case library is not empty', () => {
  assert.ok(topics.length > 0, `no topic directories found under ${CASES_DIR}`);
});

for (const topic of topics) {
  const dir = path.join(CASES_DIR, topic);

  // Every case file: the TC-*.mjs convention plus the one factory-display.mjs
  // whose id carries no TC prefix. index.mjs is the manifest, never a case.
  const caseFiles = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.mjs') && file !== 'index.mjs')
    .sort();

  const indexSource = fs.readFileSync(path.join(dir, 'index.mjs'), 'utf8');

  test(`${topic}: every case file is registered in index.mjs`, () => {
    const unregistered = caseFiles.filter((file) => !indexSource.includes(`'${file}'`));
    assert.deepEqual(
      unregistered,
      [],
      `${topic}: ${unregistered.length} case file(s) on disk are not registered in index.mjs, so run-all.mjs never runs them: ${unregistered.join(', ')}`,
    );
  });

  test(`${topic}: index.mjs registers no file that is missing from disk`, () => {
    const referenced = [...indexSource.matchAll(/file:\s*'([^']+)'/g)].map((match) => match[1]).sort();
    const missing = referenced.filter((file) => !fs.existsSync(path.join(dir, file)));
    assert.deepEqual(
      missing,
      [],
      `${topic}: index.mjs references ${missing.length} file(s) that do not exist: ${missing.join(', ')}`,
    );
  });

  test(`${topic}: no case id is registered twice`, () => {
    const ids = [...indexSource.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1]);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual(duplicates, [], `${topic}: duplicate case id(s): ${duplicates.join(', ')}`);
  });
}
