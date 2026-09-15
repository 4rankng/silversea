import { FormGroup } from '../UI';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <FormGroup label={label}>{children}</FormGroup>;
}
