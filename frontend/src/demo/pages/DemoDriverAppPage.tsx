import { DemoPlaceholderPage } from '../DemoPlaceholderPage';
import { demoNavItemRequired } from '../nav';

const item = demoNavItemRequired('/demo/driver-app');

/** /demo/driver-app — Ứng dụng Lái Xe (mobile-first, khung giả lập điện thoại). */
export default function DemoDriverAppPage() {
  return <DemoPlaceholderPage item={item} />;
}
