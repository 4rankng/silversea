import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Truck } from '@tingting/shared';
import assert from 'node:assert';
import { TrailerCard } from './trailer-card';
import { TrailerFormModal } from './TrailerFormModal';

// The CRUD hook is page-owned; the card only renders and calls actions.
vi.mock('../../hooks/useTireQueries', () => ({ useTires: () => ({ data: [], isLoading: false }) }));

const truck = (id: number, plate: string): Truck => ({
  id,
  licensePlate: plate,
} as unknown as Truck);

function trailer(id: number, licensePlate: string, type: string | null, status = 'ACTIVE') {
  return { id, licensePlate, type, status } as { id: number; licensePlate: string; type: string | null; status: string };
}

/** Both legends (desktop table-foot + mobile card list) carry the subtotals —
 *  collect every rendered legend text for the reconciliation asserts. */
function legendTexts() {
  return Array.from(document.querySelectorAll('.fleet-legend'))
    .map((legend) => (legend.textContent || '').replace(/\s+/g, ' ').trim());
}

describe('TrailerCard — summary reconciliation', () => {
  it('all-typed fleet: subtotals sum to the list count, no unknown chip', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
      <TrailerCard
        trailers={[trailer(1, 'RM-001', '40FT'), trailer(2, 'RM-002', '20FT'), trailer(3, 'RM-003', '40FT')]}
        trucks={[truck(10, '15C-001')]}
        crud={{ create: { mutate: vi.fn(), isPending: false }, update: { mutate: vi.fn(), isPending: false }, remove: { mutate: vi.fn(), isPending: false } } as never}
      />
      </MemoryRouter>
      </QueryClientProvider>,
    );

    const legends = legendTexts();
    expect(legends.length).toBeGreaterThan(0);
    for (const legend of legends) {
      expect(legend).toContain('2 × 40FT');
      expect(legend).toContain('1 × 20FT');
      expect(legend).not.toContain('Chưa rõ loại');
    }
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('mixed fleet with blank-type records: the explicit unknown bucket reconciles the total', () => {
    // The staging repro shape: many blank-type records with zero typed ones.
    const blanks = Array.from({ length: 39 }, (_, index) => trailer(100 + index, `RM-B${index}`, null));
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
      <TrailerCard
        trailers={[trailer(1, 'RM-001', '40FT'), ...blanks]}
        trucks={[truck(10, '15C-001')]}
        crud={{ create: { mutate: vi.fn(), isPending: false }, update: { mutate: vi.fn(), isPending: false }, remove: { mutate: vi.fn(), isPending: false } } as never}
      />
      </MemoryRouter>
      </QueryClientProvider>,
    );

    for (const legend of legendTexts()) {
      expect(legend).toContain('1 × 40FT');
      expect(legend).toContain('0 × 20FT');
      expect(legend).toContain('39 × Chưa rõ loại');
    }
    // ft40 + ft20 + unknown === 40 === the header count.
    expect(screen.getAllByText('40').length).toBeGreaterThan(0);
  });

  it('unexpected enum values count as unknown too (display-level tolerance)', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
      <TrailerCard
        trailers={[trailer(1, 'RM-X', '45FT'), trailer(2, 'RM-002', '20FT')]}
        trucks={[truck(10, '15C-001')]}
        crud={{ create: { mutate: vi.fn(), isPending: false }, update: { mutate: vi.fn(), isPending: false }, remove: { mutate: vi.fn(), isPending: false } } as never}
      />
      </MemoryRouter>
      </QueryClientProvider>,
    );

    for (const legend of legendTexts()) {
      expect(legend).toContain('1 × 20FT');
      expect(legend).toContain('1 × Chưa rõ loại');
    }
  });

  it('empty fleet renders the TRUE-zero summary with no unknown chip', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
      <TrailerCard
        trailers={[]}
        trucks={[]}
        crud={{ create: { mutate: vi.fn(), isPending: false }, update: { mutate: vi.fn(), isPending: false }, remove: { mutate: vi.fn(), isPending: false } } as never}
      />
      </MemoryRouter>
      </QueryClientProvider>,
    );

    for (const legend of legendTexts()) {
      expect(legend).toContain('0 × 40FT');
      expect(legend).toContain('0 × 20FT');
      expect(legend).not.toContain('Chưa rõ loại');
    }
  });
});

describe('TrailerFormModal — blank-type round-trip (the silent-retype lock)', () => {
  const blankItem = { id: 9, licensePlate: 'RM-009', type: null, maxPayloadTons: null, maxAxleLoadFrontTons: null, maxAxleLoadRearTons: null, inspectionDeadline: null, note: null };

  it('editing a Chưa rõ loại record keeps it blank; the select offers the explicit option', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TrailerFormModal isOpen saving={false} item={blankItem} onsave={() => {}} oncancel={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const trigger = document.getElementById('trailer-type-input');
    assert(trigger, 'type select renders');
    // The blank record opens on the explicit unknown option — the trigger's
    // text is '40FT' under the old forcing line, so this kills.
    expect(trigger.textContent).toContain('Chưa rõ loại');
  });

  it('saving the blank selection persists null, never a forced type', () => {
    const saved: Array<Record<string, unknown>> = [];
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TrailerFormModal isOpen saving={false} item={blankItem} onsave={(d) => saved.push(d)} oncancel={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /cập nhật|lưu/i }));
    expect(saved).toHaveLength(1);
    expect(saved[0].type).toBe(null);
  });
});
