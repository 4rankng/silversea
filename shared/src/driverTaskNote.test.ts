import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { composeDriverTaskNote, parseDriverTaskNote } from './driverTaskNote';

const KNOWN = ['HẾT HẠN', 'ĐẢO VỎ', 'GỬI VỎ BÃI ĐĂNG KHOA'];

describe('composeDriverTaskNote / parseDriverTaskNote (format v2)', () => {
  test('composes tags and free text as two lines', () => {
    assert.equal(
      composeDriverTaskNote(['HẾT HẠN', 'ĐẢO VỎ'], 'chuyển hàng sang xe khác'),
      'HẾT HẠN; ĐẢO VỎ\nchuyển hàng sang xe khác',
    );
  });

  test('skips empty parts — tags-only and text-only stay single-line', () => {
    assert.equal(composeDriverTaskNote(['HẾT HẠN'], ''), 'HẾT HẠN');
    assert.equal(composeDriverTaskNote([], 'ghi chú tay'), 'ghi chú tay');
    assert.equal(composeDriverTaskNote([], ''), '');
    assert.equal(composeDriverTaskNote(['  ', 'HẾT HẠN  '], '  '), 'HẾT HẠN');
  });

  test('compose ∘ parse is the identity on well-formed notes', () => {
    const cases: Array<{ labels: string[]; text: string }> = [
      { labels: ['HẾT HẠN', 'ĐẢO VỎ'], text: 'chuyển hàng' },
      { labels: ['GỬI VỎ BÃI ĐĂNG KHOA'], text: '' },
      { labels: [], text: 'chỉ ghi chú tự do' },
      // Manual newlines live in the text part; only line 1 is the tag line.
      { labels: ['HẾT HẠN'], text: 'dòng một\ndòng hai' },
    ];
    for (const { labels, text } of cases) {
      const note = composeDriverTaskNote(labels, text);
      const parsed = parseDriverTaskNote(note, KNOWN);
      assert.deepEqual(parsed, { selectedLabels: labels, manualText: text }, note);
      assert.equal(composeDriverTaskNote(parsed.selectedLabels, parsed.manualText), note);
    }
  });

  test('legacy v1 single-line notes parse identically to the previous lib', () => {
    const legacy = 'HẾT HẠN; ĐẢO VỎ; chuyển hàng sang xe khác';
    assert.deepEqual(parseDriverTaskNote(legacy, KNOWN), {
      selectedLabels: ['HẾT HẠN', 'ĐẢO VỎ'],
      manualText: 'chuyển hàng sang xe khác',
    });
    // Hand-written notes degrade to all-manual, never destroyed.
    assert.deepEqual(parseDriverTaskNote('HẾT HẠNg; something', KNOWN), {
      selectedLabels: [],
      manualText: 'HẾT HẠNg; something',
    });
  });

  test('unknown labels in line 1 degrade to manual text (never dropped)', () => {
    const note = 'KHÔNG CÓ TRONG POOL\nvăn bản tự do';
    const parsed = parseDriverTaskNote(note, KNOWN);
    assert.deepEqual(parsed, { selectedLabels: [], manualText: note });
    assert.equal(composeDriverTaskNote(parsed.selectedLabels, parsed.manualText), note);
  });

  test('empty and whitespace-only values parse to nothing', () => {
    assert.deepEqual(parseDriverTaskNote(null, KNOWN), { selectedLabels: [], manualText: '' });
    assert.deepEqual(parseDriverTaskNote('', KNOWN), { selectedLabels: [], manualText: '' });
    assert.deepEqual(parseDriverTaskNote('\n', KNOWN), { selectedLabels: [], manualText: '' });
  });
});
