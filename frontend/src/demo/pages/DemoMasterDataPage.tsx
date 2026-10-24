import { DemoPlaceholderPage } from '../DemoPlaceholderPage';
import { demoNavItemRequired } from '../nav';

const item = demoNavItemRequired('/demo/master-data');

/** /demo/master-data — Quản lý Đội Xe & Danh Mục. */
export default function DemoMasterDataPage() {
  return <DemoPlaceholderPage item={item} />;
}
