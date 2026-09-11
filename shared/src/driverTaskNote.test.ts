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

  // Full 14-tag pool from TODO/20260911_3 BUG4
  const FULL_TAG_POOL = [
    'HẾT HẠN',
    'ĐẢO VỎ',
    'ĐẶT ĐUÔI',
    'ĐẶT ĐẦU',
    'KIỂM HÓA',
    'QUAY ĐẦU',
    'GỬI VỎ BÃI ĐĂNG KHOA',
    'QUÁ TẢI',
    'ĐẢO HÀNG',
    'HẠ VỎ ICD QUẾ VÕ',
    'GẮP VỎ ICD QUẾ VÕ',
    'GẮP VỎ BÃI ĐĂNG KHOA',
    'HẠ VỎ BÃI TRI PHƯƠNG',
    'GẮP VỎ BÃI TRI PHƯƠNG',
  ];

  test('full 14-tag pool: all tags parse correctly', () => {
    const note = composeDriverTaskNote(FULL_TAG_POOL, 'ghi chú đầy đủ');
    const parsed = parseDriverTaskNote(note, FULL_TAG_POOL);
    assert.deepEqual(parsed, { selectedLabels: FULL_TAG_POOL, manualText: 'ghi chú đầy đủ' });
  });

  test('full 14-tag pool: subset of tags round-trips correctly', () => {
    const subset = ['ĐẶT ĐẦU', 'ĐẶT ĐUÔI', 'QUAY ĐẦU', 'QUÁ TẢI'];
    const note = composeDriverTaskNote(subset, '');
    const parsed = parseDriverTaskNote(note, FULL_TAG_POOL);
    assert.deepEqual(parsed, { selectedLabels: subset, manualText: '' });
    assert.equal(composeDriverTaskNote(parsed.selectedLabels, parsed.manualText), note);
  });

  test('full 14-tag pool: mix of known tags and unknown text degrades gracefully', () => {
    const note = 'HẾT HẠN; ĐẢO VỎ; tay駅unknown\nghi chú thêm';
    const parsed = parseDriverTaskNote(note, FULL_TAG_POOL);
    assert.deepEqual(parsed.selectedLabels, ['HẾT HẠN', 'ĐẢO VỎ']);
    assert.ok(parsed.manualText.includes('tay駅unknown'));
    assert.ok(parsed.manualText.includes('ghi chú thêm'));
  });

  test('full 14-tag pool: compose with all tags + multi-line text', () => {
    const text = 'dòng 1\ndòng 2\ndòng 3';
    const note = composeDriverTaskNote(FULL_TAG_POOL, text);
    assert.ok(note.startsWith('HẾT HẠN; ĐẢO VỎ;'));
    assert.ok(note.endsWith('dòng 1\ndòng 2\ndòng 3'));
    const parsed = parseDriverTaskNote(note, FULL_TAG_POOL);
    assert.deepEqual(parsed, { selectedLabels: FULL_TAG_POOL, manualText: text });
  });
});
