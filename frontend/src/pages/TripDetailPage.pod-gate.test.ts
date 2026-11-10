import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * SIL-694 — the governed close modal must SHOW the POD-gốc condition instead
 * of letting POST /trips/:id/complete 409 with a generic error: the readiness
 * row renders inside the close modal (role="status"), names the missing
 * paper, offers the Kế toán/CUS mark affordance, and flips to the recorded
 * state once the mark exists. Source pin in the tel-source style.
 */
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('SIL-694 — the governed close modal shows the POD-gốc gate', () => {
  const page = read('src/pages/TripDetailPage.tsx');

  it('the close intent renders the readiness row with the recovered / missing states', () => {
    expect(page).toContain("governanceIntent === 'complete' && (");
    expect(page).toContain('tdp-pod-gate');
    expect(page).toContain('POD gốc: đã thu hồi');
    expect(page).toContain('Chưa thu hồi POD gốc (chứng từ mộc đỏ)');
  });

  it('the mark affordance is gated on the backend allowlist flag and drives the hook handler', () => {
    expect(page).toContain('effectivePermissions.canMarkPodRecovered');
    expect(page).toContain('Đánh dấu đã thu hồi POD gốc');
    expect(page).toContain('page.handleMarkPodRecovered()');
  });

  it('the hook wires the mark through the pod-recovered endpoint with the trip version', () => {
    const hook = read('src/features/trip-detail/useTripDetailPage.ts');
    expect(hook).toContain('/pod-recovered');
    expect(hook).toContain('expectedVersion');
  });
});
