import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { highlightElement } from '../lib/highlight';
import { clearFocusSearchParams, useFocusDeepLink } from './useFocusDeepLink';

vi.mock('../lib/highlight', () => ({
  highlightElement: vi.fn(() => false),
}));

function FocusHarness() {
  useFocusDeepLink('ga');
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

describe('clearFocusSearchParams', () => {
  it('removes only focus animation state and preserves workspace view state', () => {
    const result = clearFocusSearchParams(
      new URLSearchParams('view=settlements&focus=42&fdur=1200&source=agent'),
    );

    expect(result.toString()).toBe('view=settlements&source=agent');
  });

  it('keeps the focus query until an asynchronously loaded target can be highlighted', async () => {
    const highlightMock = vi.mocked(highlightElement);
    highlightMock.mockReturnValueOnce(false).mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={['/governance-actions?filter=all&focus=42&source=agent']}>
        <FocusHarness />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('location-search').textContent).toContain('focus=42');
    document.body.append(document.createElement('div'));

    await waitFor(() => {
      expect(screen.getByTestId('location-search').textContent).toBe('?filter=all&source=agent');
    });
    expect(highlightMock).toHaveBeenCalledWith('ga-42', 2000);
  });
});
