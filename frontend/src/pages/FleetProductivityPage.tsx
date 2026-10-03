import { useState } from 'react';
import { Calendar, TrendingUp } from 'lucide-react';
import { PageHeader } from '../components/UI';
import { DailyProductivityView } from '../features/fleet-productivity/DailyProductivityView';
import { MonthlyProductivityView } from '../features/fleet-productivity/MonthlyProductivityView';
import './FleetProductivityPage.css';

export default function FleetProductivityPage() {
  const [activeTab, setActiveTab] = useState<'DAILY' | 'MONTHLY'>('DAILY');

  return (
    <div className="fleet-productivity-page">
      <PageHeader
        title="Hiệu quả Năng suất Xe Nội Bộ"
        description="Theo dõi và kiểm tra tỷ lệ kẹp ghép, kết hợp và lấy lẻ chuyển kho của đội xe công ty"
      />

      <div className="fleet-productivity-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'DAILY'}
          className={`fleet-productivity-tab-btn ${
            activeTab === 'DAILY' ? 'fleet-productivity-tab-btn--active' : ''
          }`}
          onClick={() => setActiveTab('DAILY')}
        >
          <Calendar size={15} style={{ marginRight: 6 }} />
          Toàn đội trong 1 ngày
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'MONTHLY'}
          className={`fleet-productivity-tab-btn ${
            activeTab === 'MONTHLY' ? 'fleet-productivity-tab-btn--active' : ''
          }`}
          onClick={() => setActiveTab('MONTHLY')}
        >
          <TrendingUp size={15} style={{ marginRight: 6 }} />
          Từng xe trong 1 tháng
        </button>
      </div>

      {activeTab === 'DAILY' && <DailyProductivityView />}
      {activeTab === 'MONTHLY' && <MonthlyProductivityView />}
    </div>
  );
}
