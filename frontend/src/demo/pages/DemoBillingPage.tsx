import { DemoPlaceholderPage } from '../DemoPlaceholderPage';
import { demoNavItemRequired } from '../nav';

const item = demoNavItemRequired('/demo/billing');

/** /demo/billing — Đối Soát & Công Nợ (AR/AP Billing). */
export default function DemoBillingPage() {
  return <DemoPlaceholderPage item={item} />;
}
