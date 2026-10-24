import { DemoPlaceholderPage } from '../DemoPlaceholderPage';
import { demoNavItemRequired } from '../nav';

const item = demoNavItemRequired('/demo/dispatch');

/** /demo/dispatch — Bàn Điều Vận (Dispatch Center). */
export default function DemoDispatchPage() {
  return <DemoPlaceholderPage item={item} />;
}
