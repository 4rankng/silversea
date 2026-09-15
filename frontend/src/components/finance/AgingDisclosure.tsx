import type { ReactNode } from 'react';
import '../../styles/financial-aging.css';

/** Keep account records primary while preserving native keyboard access to every age bucket. */
export function AgingDisclosure({ label, children }: { label: string; children: ReactNode }) {
  return <details className="financial-aging-disclosure"><summary>{label}</summary>{children}</details>;
}
