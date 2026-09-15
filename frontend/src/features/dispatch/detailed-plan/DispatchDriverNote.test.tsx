import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DispatchDriverNote } from './DispatchDriverNote';

const labels = ['Đặt đầu', 'Đặt đuôi'];

describe('DispatchDriverNote', () => {
  it.each([
    'Đặt đầu; Đặt đuôi\n- gọi cổng\n- giữ bản gốc',
    'Đặt đầu; Đặt đuôi; - gọi cổng\n- giữ bản gốc',
  ])('separates tasks from manual newlines in current and legacy format: %s', (value) => {
    const { container } = render(<DispatchDriverNote value={value} labels={labels} />);
    expect(container.querySelector('[data-note-section="tasks"]')?.textContent).toBe('Tác vụĐẶT ĐẦU; ĐẶT ĐUÔI');
    expect(container.querySelector('.dispatch-driver-note__text')?.textContent).toBe('- gọi cổng\n- giữ bản gốc');
  });

  it('preserves an unknown or retired label and every manual line instead of guessing', () => {
    const text = 'Nhãn cũ\nGhi chú giữ nguyên\nDòng ba';
    const { container } = render(<DispatchDriverNote value={text} labels={labels} />);
    expect(screen.queryByText('Tác vụ')).toBeNull();
    expect(container.querySelector('.dispatch-driver-note__text')?.textContent).toBe(text);
  });

  it('renders task-only notes without a blank manual section', () => {
    const { container } = render(<DispatchDriverNote value="Đặt đầu" labels={labels} compact />);
    expect(screen.getByText('ĐẶT ĐẦU')).toBeTruthy();
    expect(container.querySelector('[data-note-section="manual"]')).toBeNull();
  });

  it('preserves stored text if the catalog is unavailable and restores structure when it loads', () => {
    const value = 'Đặt đầu\nGọi cổng\nGặp anh B';
    const { container, rerender } = render(<DispatchDriverNote value={value} labels={[]} />);
    expect(container.querySelector('.dispatch-driver-note__text')?.textContent).toBe(value);
    rerender(<DispatchDriverNote value={value} labels={labels} />);
    expect(screen.getByText('ĐẶT ĐẦU')).toBeTruthy();
    expect(container.querySelector('.dispatch-driver-note__text')?.textContent).toBe('Gọi cổng\nGặp anh B');
  });

  it('preserves whitespace in both read surfaces and only clamps the compact preview', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DispatchDriverNote.css'), 'utf8');
    expect(css).toMatch(/\.dispatch-driver-note__tasks,\s*\.dispatch-driver-note__text\s*\{[^}]*white-space: pre-wrap;/);
    expect(css).toMatch(/\.dispatch-driver-note--compact \.dispatch-driver-note__tasks,\s*\.dispatch-driver-note--compact \.dispatch-driver-note__text\s*\{[^}]*-webkit-line-clamp: 2;/);
  });
});
