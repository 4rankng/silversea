import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PhotoImage } from './PhotoImage';

describe('protected photo display boundary', () => {
  it('shows an honest accessible unavailable slot without an empty image source', () => {
    render(<PhotoImage src="" alt="Chứng từ 1" />);
    expect(screen.getByRole('img', { name: 'Chứng từ 1 (không tải được)' })).toHaveTextContent('Không tải được');
    expect(document.querySelector('img')).toBeNull();
  });

  it('does not turn a whitespace source into an image request', () => {
    render(<PhotoImage src="   " alt="Biên lai" />);
    expect(screen.getByRole('img', { name: 'Biên lai (không tải được)' })).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('preserves resolved image props and caller error handling while exposing decode failure', () => {
    const onError = vi.fn();
    render(<PhotoImage src="/photos/receipt.jpg" alt="Biên lai" className="receipt-thumb" loading="lazy" onError={onError} />);
    const image = screen.getByAltText('Biên lai');
    expect(image).toHaveAttribute('src', '/photos/receipt.jpg');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveClass('receipt-thumb');
    fireEvent.error(image);
    expect(onError).toHaveBeenCalledOnce();
    expect(screen.getByRole('img', { name: 'Biên lai (không tải được)' })).toHaveTextContent('Không tải được');
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders a replaced source after failure and allows the former source to load again', () => {
    const { rerender } = render(<PhotoImage src="/photos/first.jpg" alt="Biên lai" />);
    fireEvent.error(screen.getByAltText('Biên lai'));
    rerender(<PhotoImage src="/photos/second.jpg" alt="Biên lai" />);
    expect(screen.getByAltText('Biên lai')).toHaveAttribute('src', '/photos/second.jpg');
    rerender(<PhotoImage src="/photos/first.jpg" alt="Biên lai" />);
    expect(screen.getByAltText('Biên lai')).toHaveAttribute('src', '/photos/first.jpg');
  });
});
