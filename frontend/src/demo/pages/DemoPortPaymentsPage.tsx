import { DemoPlaceholderPage } from '../DemoPlaceholderPage';
import { demoNavItemRequired } from '../nav';

const item = demoNavItemRequired('/demo/port-payments');

/** /demo/port-payments — Duyệt Chi Cảng & Hoàn Ứng. */
export default function DemoPortPaymentsPage() {
  return <DemoPlaceholderPage item={item} />;
}
