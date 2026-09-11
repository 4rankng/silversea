import { describe, expect, it } from 'vitest';
import { composeNote, parseNote } from './dispatchTaskTags';

describe('composeNote', () => {
  it('joins tags first, then manual text, with "; "', () => {
    expect(composeNote(['Đặt đầu', 'Lấy vỏ ICD đi đóng'], 'gọi lái trước 30p')).toBe('Đặt đầu; Lấy vỏ ICD đi đóng; gọi lái trước 30p');
  });

  it('emits tags only when manual text is empty', () => {
    expect(composeNote(['Đặt đầu'], '   ')).toBe('Đặt đầu');
  });

  it('emits manual text only when no tags are selected', () => {
    expect(composeNote([], 'chỉ ghi tay')).toBe('chỉ ghi tay');
  });

  it('returns empty string for no tags and empty manual', () => {
    expect(composeNote([], '')).toBe('');
  });
});

describe('parseNote', () => {
  const known = ['Đặt đầu', 'Đặt đuôi', 'Lấy vỏ ICD đi đóng'];

  it('splits known tags from manual text', () => {
    expect(parseNote('Đặt đầu; Lấy vỏ ICD đi đóng; gọi lái trước 30p', known)).toEqual({
      selectedLabels: ['Đặt đầu', 'Lấy vỏ ICD đi đóng'],
      manualText: 'gọi lái trước 30p',
    });
  });

  it('degrades unknown notes to all-manual', () => {
    expect(parseNote('đặt đầu (thủ công); gọi trước', known)).toEqual({
      selectedLabels: [],
      manualText: 'đặt đầu (thủ công); gọi trước',
    });
  });

  it('round-trips compose ∘ parse for a composed note', () => {
    const note = composeNote(['Đặt đầu', 'Lấy vỏ ICD đi đóng'], 'gọi lái trước 30p');
    expect(parseNote(note, known)).toEqual({
      selectedLabels: ['Đặt đầu', 'Lấy vỏ ICD đi đóng'],
      manualText: 'gọi lái trước 30p',
    });
  });

  it('round-trips an untouched note byte-identically', () => {
    const note = 'Đặt đầu; Đặt đuôi; gọi lái trước 30p';
    const parsed = parseNote(note, known);
    expect(composeNote(parsed.selectedLabels, parsed.manualText)).toBe(note);
  });

  it('handles empty and null notes', () => {
    expect(parseNote(null, known)).toEqual({ selectedLabels: [], manualText: '' });
    expect(parseNote('', known)).toEqual({ selectedLabels: [], manualText: '' });
  });
});
