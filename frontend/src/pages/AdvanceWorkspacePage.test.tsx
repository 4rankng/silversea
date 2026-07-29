import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AdvanceWorkspacePage, {
  buildAdvanceWorkspaceSearch,
  resolveAdvanceWorkspaceView,
} from './AdvanceWorkspacePage';

vi.mock('./AdminAdvancesPage', () => ({
  default: ({ embedded }: { embedded?: boolean }) => (
    <div>Advance requests panel · {embedded ? 'embedded' : 'standalone'}</div>
  ),
}));

vi.mock('./AdminAdvanceSettlementsPage', () => ({
  default: ({ embedded }: { embedded?: boolean }) => (
    <div>Advance settlements panel · {embedded ? 'embedded' : 'standalone'}</div>
  ),
}));

function renderWorkspace(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <AdvanceWorkspacePage />
    </MemoryRouter>,
  );
}

describe('AdvanceWorkspacePage', () => {
  it('defaults invalid or missing view values to advance requests', () => {
    expect(resolveAdvanceWorkspaceView(null)).toBe('requests');
    expect(resolveAdvanceWorkspaceView('unknown')).toBe('requests');
    expect(resolveAdvanceWorkspaceView('settlements')).toBe('settlements');
  });

  it('switches views without carrying a stale focus target', () => {
    const search = buildAdvanceWorkspaceSearch(
      new URLSearchParams('view=requests&focus=17&fdur=900&source=agent'),
      'settlements',
    );
    expect(search).toBe('?view=settlements&source=agent');
  });

  it('renders the request workflow as the canonical default', () => {
    renderWorkspace('/advances');
    expect(screen.getByRole('heading', { level: 1, name: 'Tạm ứng & hoàn ứng' })).toBeTruthy();
    expect(screen.getByText('Advance requests panel · embedded')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Yêu cầu tạm ứng/ }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /Mở Trung tâm phê duyệt/ }).getAttribute('href')).toBe('/governance-actions');
  });

  it('renders the settlement workflow from the durable query-backed view', () => {
    renderWorkspace('/advances?view=settlements');
    expect(screen.getByText('Advance settlements panel · embedded')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Phiếu hoàn ứng/ }).getAttribute('aria-current')).toBe('page');
  });
});
