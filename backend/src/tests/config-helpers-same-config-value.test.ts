/**
 * Guard suite for sameConfigValue / hasMaterialValueChange (card 20260926_16):
 * these helpers decide whether a customer-config update is a MATERIAL change
 * and therefore whether approval routing fires. A wrong array-join separator
 * silently suppresses that decision — two real corruptions of this exact line
 * preceded this suite: a literal NUL byte (join('\0'), present since 09-09 and
 * repaired in 7065e629) and an empty separator (join('')) that fuses
 * ['ab','c'] and ['a','bc'] into the same string and was stripped before
 * landing. The separator pin reads the source literal so a control-byte or
 * empty separator cannot slip through behaviorally-equivalent values.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { sameConfigValue, hasMaterialValueChange } from '../routes/config/config-helpers';

describe('sameConfigValue', () => {
  test('array comparison is order-insensitive set equality', () => {
    assert.equal(sameConfigValue(['b', 'a'], ['a', 'b']), true);
  });

  test('array boundary never fuses: ["ab","c"] differs from ["a","bc"]', () => {
    assert.equal(sameConfigValue(['ab', 'c'], ['a', 'bc']), false);
  });

  test('numeric strings equal their numeric payload', () => {
    assert.equal(sameConfigValue('10.00', 10), true);
    assert.equal(sameConfigValue(10, '10'), true);
  });

  test('payload-omitted keys (undefined incoming) never count as a change', () => {
    assert.equal(sameConfigValue('anything', undefined), true);
  });

  test('array join separator is a real delimiter — never empty, never a control byte', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../routes/config/config-helpers.ts', import.meta.url)),
      'utf8',
    );
    const joins = [...source.matchAll(/\.join\((.{1,12}?)\)/g)].map((match) => match[1]);
    assert.ok(joins.length >= 2, 'expected the two join sites in config-helpers.ts');
    for (const raw of joins) {
      assert.equal(
        raw,
        "' '",
        `.join(${JSON.stringify(raw)}) in config-helpers.ts must stay .join(' ') — an empty or ` +
          'control-byte separator fuses distinct array elements and silently suppresses material-change detection',
      );
    }
  });
});

describe('hasMaterialValueChange', () => {
  test('order-only reshuffles are not material; boundary-fused arrays are', () => {
    const fields = new Set(['evidence']);
    assert.equal(hasMaterialValueChange(fields, { evidence: ['b', 'a'] }, { evidence: ['a', 'b'] }), false);
    assert.equal(
      hasMaterialValueChange(fields, { evidence: ['ab', 'c'] }, { evidence: ['a', 'bc'] }),
      true,
    );
  });
});
