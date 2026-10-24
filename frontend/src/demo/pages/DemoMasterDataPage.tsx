/**
 * /demo/master-data — Quản lý Đội Xe & Danh Mục (SIL-161, spec
 * 2026.10.24_Demo_layout.docx §PHÂN HỆ 4): ba tab cấu hình gốc — Đội xe nội
 * bộ, Đối tác và Rate Engine (ma trận phí nâng/hạ + giá cước). Fixture-only.
 */
import { useState } from 'react';
import { Tabs } from '@/design-system/Tabs';
import { demoNavItemRequired } from '../nav';
import { FleetTab } from '../master-data/FleetTab';
import { PartnersTab } from '../master-data/PartnersTab';
import { RateEngineTab } from '../master-data/RateEngineTab';

const item = demoNavItemRequired('/demo/master-data');

const TABS = [
  { id: 'fleet', label: 'Đội xe nội bộ' },
  { id: 'partners', label: 'Đối tác' },
  { id: 'rates', label: 'Rate Engine' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function DemoMasterDataPage() {
  const [tab, setTab] = useState<TabId>('fleet');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-brand-700">
          <item.icon className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-display-xs font-semibold text-primary">{item.heading}</h1>
          <p className="max-w-[72ch] text-md text-tertiary">{item.description}</p>
        </div>
      </header>

      <Tabs
        tabs={TABS.map(({ id, label }) => ({ id, label }))}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
        variant="boxed"
        ariaLabel="Nhóm tab danh mục"
        presentation="responsive"
      />

      <div role="tabpanel" aria-label={TABS.find((entry) => entry.id === tab)?.label}>
        {tab === 'fleet' && <FleetTab />}
        {tab === 'partners' && <PartnersTab />}
        {tab === 'rates' && <RateEngineTab />}
      </div>

      <p className="text-sm text-quaternary">
        Trang demo — dữ liệu tĩnh từ <code>frontend/src/demo/data</code>, không gọi API. Mọi chỉnh
        sửa chỉ lưu trong phiên.
      </p>
    </div>
  );
}
