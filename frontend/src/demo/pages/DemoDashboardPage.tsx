import { DemoPlaceholderPage } from '../DemoPlaceholderPage';
import { demoNavItemRequired } from '../nav';

const item = demoNavItemRequired('/demo/dashboard');

/** /demo/dashboard — Tổng quan Đội xe (Control Tower). */
export default function DemoDashboardPage() {
  return <DemoPlaceholderPage item={item} />;
}
