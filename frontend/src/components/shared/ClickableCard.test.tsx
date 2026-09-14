import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ClickableCard } from './ClickableCard';

function Location() { return <output aria-label="Current route">{useLocation().pathname}</output>; }

describe('ClickableCard', () => {
  it.each(['Enter', ' '])('navigates exactly once when activated with %s', (key) => {
    const onClick = vi.fn();
    render(<MemoryRouter><ClickableCard to="/customers/42" onClick={onClick}>Customer 42</ClickableCard><Location /></MemoryRouter>);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Customer 42' }), { key });
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/customers/42');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('preserves nested controls and allows callers to cancel navigation', () => {
    const onClick = vi.fn((event) => event.preventDefault());
    const childClick = vi.fn();
    render(<MemoryRouter><ClickableCard to="/customers/42" onClick={onClick} ariaLabel="Customer row"><button onClick={childClick}>Edit</button><input aria-label="Select customer" type="checkbox" /></ClickableCard><Location /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Edit' }), { key: 'Enter' });
    expect(childClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Customer row' }), { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/');
  });
});
