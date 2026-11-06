// SIL-688 (id 800 — QA 06/11): the review page (/shipments/:id) carries the
// "Xóa lô" action in its view cluster — the destructive law (LAST position,
// danger voice `secondary-destructive`), the host's role gate (omitted prop
// = the cluster renders without it, exactly the CUS/ADMIN split the BE
// `requireRoles` answers), and the lifecycle guards (accounting lock /
// dispatched legs disable it with the reason in the accessible name).
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShipmentViewActions } from './ShipmentViewActions';

const base = { onBack: () => {} };

describe('ShipmentViewActions — Xóa lô (SIL-688)', () => {
  it('renders the delete action last, in the danger voice, clickable when armed', () => {
    render(
      <ShipmentViewActions
        {...base}
        onEdit={() => {}}
        onCreateNew={() => {}}
        onDelete={() => {}}
      />,
    );
    const buttons = screen.getAllByRole('button').map((b) => b.textContent?.trim());
    // Destructive LAST (dispatch menu law), after the one primary.
    expect(buttons[buttons.length - 1]).toBe('Xóa lô');
    const del = screen.getByRole('button', { name: 'Xóa lô' });
    expect(del).not.toBeDisabled();
    // The danger voice is the `secondary-destructive` UUI color variant + the
    // Trash2 leading icon (class names are tailwind tokens — no literal
    // 'destructive' string to match on).
    expect(del.querySelector('svg')).not.toBeNull();
  });

  it('renders no delete affordance when the role gate omits onDelete (BE refusés roles)', () => {
    render(<ShipmentViewActions {...base} />);
    expect(screen.queryByRole('button', { name: 'Xóa lô' })).toBeNull();
  });

  it('disables with the lifecycle reason when the lot carries a dispatched leg', () => {
    render(
      <ShipmentViewActions
        {...base}
        onDelete={() => {}}
        deleteBlockedReason="Chỉ xóa được khi mọi container chưa phát lệnh"
      />,
    );
    const del = screen.getByRole('button', { name: 'Xóa lô — Chỉ xóa được khi mọi container chưa phát lệnh' });
    expect(del).toBeDisabled();
  });

  it('disables with the lock reason on an accounting-locked lot', () => {
    render(
      <ShipmentViewActions
        {...base}
        onEdit={() => {}}
        onDelete={() => {}}
        deleteLocked
      />,
    );
    expect(screen.getByRole('button', { name: 'Xóa lô — lô đã khóa kế toán' })).toBeDisabled();
  });

  it('clicking the armed button invokes onDelete exactly once (opens the confirm upstream)', () => {
    const onDelete = vi.fn();
    render(<ShipmentViewActions {...base} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: 'Xóa lô' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
