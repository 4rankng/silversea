import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QuickIssueOrderButton } from './QuickIssueOrderButton';
import type { DispatchShipmentResponse } from '../../../api/shipmentClient';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const listFleet = vi.hoisted(() => vi.fn());
vi.mock('../../../api/dispatchPlanningClient', () => ({ listDispatchFleetResources: listFleet }));
const ownTruck = { id: 12, licensePlate: '15H-012.34', assignedDriverId: 34, assignedDriverName: 'Anh Bình' };
const row = (carrierType: 'OWN' | 'EXTERNAL' = 'OWN') => ({
  fulfillmentId: 1, version: 3, shipmentId: 4, shipmentCode: 'VID-DSP', taskStatus: 'READY',
  container: { containerNumber: 'CSQU3054383' }, docs: { billNumber: 'VID-DSP-BL' },
  time: { deliveryDate: '2026-09-15', runHour: 14, runAt: '2026-09-15T07:17:00.000Z' },
  dispatch: { carrierType, assignedPlate: '15H-012.34', externalCarrierId: carrierType === 'EXTERNAL' ? 8 : null, externalCarrierVehicleId: null },
} as DispatchDetailPlanRow);

beforeEach(() => { vi.clearAllMocks(); listFleet.mockResolvedValue({ items: [ownTruck] }); });

describe('VID-DSP-02 direct release', () => {
  it('VID-DSP-05 presents one icon-only action with a descriptive accessible name and tooltip', () => {
    render(<QuickIssueOrderButton row={row()} onIssueOrder={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Phát lệnh · CSQU3054383' });
    expect(button.textContent).toBe('');
    expect(button).toHaveAttribute('title', 'Phát lệnh ngay theo thông tin điều phối đã lưu');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button).toHaveAttribute('aria-busy', 'false');
    expect(button).not.toBeDisabled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('VID-DSP-05 keeps a compact square desktop target and a square touch target on phones and tablets', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/DetailedPlanGrid.css'), 'utf8');
    const iconRule = css.match(/\.detailed-plan-grid__note-action--icon\s*\{([^}]+)\}/)?.[1] ?? '';
    expect(iconRule).toMatch(/width:\s*28px/);
    expect(iconRule).toMatch(/min-height:\s*28px/);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\),\s*\(pointer:\s*coarse\)\s*\{\s*\.detailed-plan-grid__note-action--icon\s*\{[^}]*width:\s*var\(--control-touch-h,\s*44px\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*767px\),\s*\(pointer:\s*coarse\)\s*\{\s*\.detailed-plan-grid__note-action--icon\s*\{[^}]*min-height:\s*var\(--control-touch-h,\s*44px\)/);
  });

  it('issues with one click and resolves fleet only on demand, preserving exact planned appointment', async () => {
    const issue = vi.fn().mockResolvedValue({});
    render(<QuickIssueOrderButton row={row()} onIssueOrder={issue} />);
    expect(listFleet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Phát lệnh · CSQU3054383' }));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
    expect(issue.mock.calls[0][1]).toMatchObject({ truckId: 12, driverId: 34, plannedStartAt: '2026-09-15T07:17:00.000Z' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('uses Vietnam time for a legacy date/hour row independently of the browser timezone', async () => {
    const issue = vi.fn().mockResolvedValue({});
    const legacy = row('EXTERNAL');
    legacy.time = { deliveryDate: '2026-09-15', runHour: 14, runAt: null };
    render(<QuickIssueOrderButton row={legacy} onIssueOrder={issue} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
    expect(issue.mock.calls[0][1].plannedStartAt).toBe('2026-09-15T07:00:00.000Z');
  });

  it('keeps synchronous repeated clicks and pending lookup/mutation to one request', async () => {
    let finishLookup!: (value: { items: typeof ownTruck[] }) => void;
    let finishIssue!: (value: DispatchShipmentResponse) => void;
    listFleet.mockImplementation(() => new Promise((resolve) => { finishLookup = resolve; }));
    const issue = vi.fn(() => new Promise<DispatchShipmentResponse>((resolve) => { finishIssue = resolve; }));
    render(<QuickIssueOrderButton row={row()} onIssueOrder={issue} />);
    const button = screen.getByRole('button');
    act(() => { button.click(); button.click(); });
    expect(listFleet).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName('Đang phát lệnh · CSQU3054383');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg.tt-animate-spin')).not.toBeNull();
    await act(async () => finishLookup({ items: [ownTruck] }));
    expect(issue).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await act(async () => finishIssue({
      fulfillmentId: 1, version: 4,
      trip: { id: 55, version: 1, tripCode: 'VID-DSP', status: 'CREATED', plannedStartAt: null, plannedEndAt: null, carrierType: 'OWN', truckId: 12, trailerId: 2, driverId: 34, externalCarrierId: null, externalPlateNumber: null, externalDriverName: null, externalDriverPhone: null },
      notification: { type: 'TRIP_DISPATCHED', deliveredInApp: true, pushAttempted: true }, replayed: false,
    }));
    expect(issue).toHaveBeenCalledTimes(1);
    expect(button).not.toBeDisabled();
    expect(button).toHaveAccessibleName('Phát lệnh · CSQU3054383');
    expect(button).toHaveAttribute('aria-busy', 'false');
    expect(button.querySelector('svg.tt-animate-spin')).toBeNull();
  });

  it('issues an external saved assignment without mandatory driver or extra confirmation', async () => {
    const issue = vi.fn().mockResolvedValue({});
    render(<QuickIssueOrderButton row={row('EXTERNAL')} onIssueOrder={issue} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
    expect(listFleet).not.toHaveBeenCalled();
    expect(issue.mock.calls[0][1]).toMatchObject({ carrierType: 'EXTERNAL', externalCarrierId: 8, externalPlateNumber: '15H-012.34' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows actionable readiness error without mutation when truck has no driver, then allows retry', async () => {
    listFleet.mockResolvedValueOnce({ items: [{ ...ownTruck, assignedDriverId: null }] });
    const issue = vi.fn().mockResolvedValue({});
    render(<QuickIssueOrderButton row={row()} onIssueOrder={issue} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Xe chưa gán tài xế');
    expect(issue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retains a failed release error in the row and retries the same assignment', async () => {
    const issue = vi.fn().mockRejectedValueOnce(new Error('Xe đầu kéo đã bị trùng lịch kế hoạch.')).mockResolvedValueOnce({});
    render(<QuickIssueOrderButton row={row()} onIssueOrder={issue} />);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Xe đầu kéo đã bị trùng lịch kế hoạch.');
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(2));
    expect(issue.mock.calls[1][0]).toEqual(row());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
