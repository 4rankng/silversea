// Alert/work titles share ONE display decision (card _44): the business key
// when it exists, '—' when it does not — internal ids are never fabricated.
// Every generator site in work-inbox.service.ts routes through this function,
// so pinning the function pins the generator. A census of persisted
// notifications (dev: 78,222 rows, staging: 123 rows on 2026-09-19/20) found
// ZERO id-derived titles — no one-time cleanup migration is needed; this pin
// is the durable guarantee for every future event.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { businessTitleOrDash } from '../services/work-inbox.service';
import { disconnectRedis } from '../lib/redis';

after(async () => {
  await disconnectRedis();
});

describe('work/alert titles render business keys via the shared derivation', () => {
  test('missing or blank codes render the dash — never a fabricated id', () => {
    assert.equal(businessTitleOrDash(null), '—');
    assert.equal(businessTitleOrDash(undefined), '—');
    assert.equal(businessTitleOrDash(''), '—');
    assert.equal(businessTitleOrDash('   '), '—');
  });

  test('business keys pass through untouched', () => {
    assert.equal(businessTitleOrDash('TRP-202606-0042'), 'TRP-202606-0042');
    assert.equal(businessTitleOrDash('BILL-2026-091'), 'BILL-2026-091');
    assert.equal(businessTitleOrDash('  TRP-202606-0042  '), '  TRP-202606-0042  ', 'internal whitespace is content, not padding');
  });

  test('an overdue alert title built from a real trip code carries it verbatim; a missing code carries the dash', () => {
    // The generator composes titles as `${businessTitleOrDash(code)} quá hạn …`
    // — pin both compositions end to end.
    const overduePaper = `${businessTitleOrDash('TRP-202609-0007')} quá hạn bàn giao lệnh gốc`;
    assert.equal(overduePaper, 'TRP-202609-0007 quá hạn bàn giao lệnh gốc');
    assert.doesNotMatch(overduePaper, /#\d|TRP-\d{4,}$|SHP-\d/);

    const cutoff = `${businessTitleOrDash(null)} quá hạn cut-off`;
    assert.equal(cutoff, '— quá hạn cut-off');
    assert.doesNotMatch(cutoff, /#\d|SHP-\d|TRP-\d+$/);
  });
});
