import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TripPodSubmission } from './TripPodSubmission';

const css = readFileSync(resolve(process.cwd(), 'src/components/trip/TripPodSubmission.css'), 'utf8');

describe('DRV-FOLLOWUP-005 responsive document rows', () => {
  it('shares content-sized rows between tablet columns and keeps action touch targets', () => {
    const tablet = css.match(/@media \(min-width: 700px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(tablet).toMatch(/\.trip-pod__card\s*\{[^}]*grid-row:\s*span 3;[^}]*grid-template-rows:\s*subgrid;[^}]*align-items:\s*start;/);
    expect(tablet).toMatch(/\[data-editable="false"\] \.trip-pod__card\s*\{[^}]*grid-row:\s*span 2;/);
    expect(css).toMatch(/\.trip-pod__actions\s*\{[^}]*align-self:\s*start;/);
    expect(css).toMatch(/\.trip-pod__action,\s*\.trip-pod__submit\s*\{[^}]*min-height:\s*44px;/);
    const header = css.match(/\.trip-pod__card-head\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(header).not.toMatch(/(?:min-|max-)?height\s*:/);
  });

  it('uses two visible tracks for read-only groups and three for editable groups', () => {
    const props = {
      tripVersion: 1, currentSubmission: null, history: [], creatingDraft: false, uploading: false,
      onEnsureDraft: vi.fn(), onUploadFile: vi.fn(),
    };
    const { container, rerender } = render(<TripPodSubmission {...props} />);
    const grid = container.querySelector('.trip-pod__grid');
    expect(grid).toHaveAttribute('data-editable', 'true');
    expect(grid?.querySelectorAll('.trip-pod__actions')).toHaveLength(2);
    rerender(<TripPodSubmission {...props} readOnlyReason="Chuyến đã hoàn thành." />);
    expect(grid).toHaveAttribute('data-editable', 'false');
    expect(grid?.querySelector('.trip-pod__actions')).toBeNull();
    grid?.querySelectorAll('.trip-pod__card').forEach((card) => {
      expect(card.children).toHaveLength(2);
    });
  });
});
