import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useForwarderContainerForm } from './use-forwarder-container-form';

const mutate = vi.hoisted(() => vi.fn());
const reset = vi.fn();
vi.mock('../../hooks/useQueries', () => ({
  useCreateForwarderContainer: () => ({ mutate, isPending: false, reset }),
}));

function Probe() {
  const controller = useForwarderContainerForm(31);
  return (
    <div>
      <input
        aria-label="Số container"
        value={controller.form.containerNumber}
        onChange={(event) => controller.setForm((form) => ({ ...form, containerNumber: event.target.value }))}
      />
      <button type="button" onClick={controller.add}>Lưu</button>
      {controller.error && (
        <>
          <span role="alert">{controller.error.message}</span>
          {controller.error.suggestion && (
            <button type="button" onClick={controller.applySuggestion}>
              Dùng "{controller.error.suggestion}"
            </button>
          )}
        </>
      )}
      <span data-testid="value">{controller.form.containerNumber}</span>
    </div>
  );
}

describe('useForwarderContainerForm — ISO 6346 entry gate', () => {
  beforeEach(() => {
    mutate.mockClear();
    reset.mockClear();
  });

  it("rejects 'ABC' before any request — inline message, input preserved", () => {
    const { container } = render(<Probe />);
    fireEvent.change(container.querySelector('input')!, { target: { value: 'ABC' } });
    fireEvent.click(screen5(container));

    expect(mutate).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('sai định dạng');
    // The typed input stays for correction.
    expect(container.querySelector('[data-testid="value"]')?.textContent).toBe('ABC');
  });

  it('rejects a wrong check digit with the one-tap suggestion, and applying it corrects the field', () => {
    const { container } = render(<Probe />);
    fireEvent.change(container.querySelector('input')!, { target: { value: 'TCKU1234567' } });
    fireEvent.click(screen5(container));

    expect(mutate).not.toHaveBeenCalled();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('chữ số kiểm tra');
    const suggestion = Array.from(container.querySelectorAll('button'))
      .find((button) => (button.textContent || '').includes('Dùng'));
    expect(suggestion).toBeTruthy();
    // The shared validator's near-miss suggestion for TCKU1234567 is ...560.
    expect(suggestion?.textContent).toContain('TCKU1234560');
    fireEvent.click(suggestion!);
    expect(container.querySelector('[data-testid="value"]')?.textContent).toBe('TCKU1234560');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('sends the normalized canonical number for a valid input', () => {
    const { container } = render(<Probe />);
    fireEvent.change(container.querySelector('input')!, { target: { value: 'tcku 123456 0' } });
    fireEvent.click(screen5(container));

    expect(mutate).toHaveBeenCalledTimes(1);
    const { tripId, data } = mutate.mock.calls[0][0];
    expect(tripId).toBe(31);
    expect(data.containerNumber).toBe('TCKU1234560');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('blocks a blank submit with the empty message', () => {
    const { container } = render(<Probe />);
    fireEvent.click(screen5(container));
    expect(mutate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('để trống');
  });
});

function screen5(container: HTMLElement) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Lưu')!;
}
