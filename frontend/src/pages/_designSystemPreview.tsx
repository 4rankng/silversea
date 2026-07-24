/**
 * Design-system preview / scratch page.
 *
 * Dev-only surface that renders every primitive shipped by the Tailkit polish
 * plan so they can be visually verified at the four NEPO breakpoints
 * (420 / 640 / 1023 / 1100) before they land on real pages.
 *
 * Mount behind a dev-only route (see App.tsx). Tree-shaken out of production
 * builds because the entry only imports this file under `import.meta.env.DEV`.
 *
 * Plan: plans/260719-frontend-polish-tailkit/
 */
import { useState, type CSSProperties } from 'react';
import { Plus, FilePlus, LayoutDashboard, Archive, Truck, DollarSign, AlertTriangle, CheckCircle, Info, AlertCircle } from 'lucide-react';
import { Tabs, EmptyState, Sparkline } from '@/design-system';
import { Banner, CommandPalette, useCommandHotkey, type CommandItem } from '@/components/shared';
import { KPI } from '@/components/UI';

export function DesignSystemPreview() {
  const [tab, setTab] = useState('all');
  const [showPalette, setShowPalette] = useState(false);
  useCommandHotkey(() => setShowPalette(true));

  const commands: CommandItem[] = [
    { id: 'new-trip', label: 'Tạo chuyến mới', icon: FilePlus, shortcut: ['Ctrl', 'N'], group: 'Chuyến', run: () => alert('demo') },
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, hint: 'Tổng quan', group: 'Điều hướng', run: () => alert('demo') },
    { id: 'fleet', label: 'Đội xe', icon: Truck, group: 'Điều hướng', run: () => alert('demo') },
    { id: 'archive', label: 'Lưu trữ', icon: Archive, group: 'Điều hướng', run: () => alert('demo') },
    { id: 'profit', label: 'Báo cáo P&L', icon: DollarSign, hint: 'Kỳ hiện tại', group: 'Báo cáo', run: () => alert('demo') },
  ];

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-3xl)', margin: 0 }}>Design System Preview</h1>
      <p style={{ color: 'var(--ink-3)', marginTop: 0 }}>Demo of primitives shipped by plan 260719-frontend-polish-tailkit.</p>

      {/* T3 — Banner */}
      <section>
        <h2 style={sectionH2}>T3 · Banner</h2>
        <Banner variant="info" icon={Info} dismissKey="demo-info">Hệ thống bảo trì lúc 23:00 tối nay.</Banner>
        <div style={{ height: 8 }} />
        <Banner variant="success" icon={CheckCircle} dismissKey="demo-success">Đã đối soát thành công kỳ lương tháng 6.</Banner>
        <div style={{ height: 8 }} />
        <Banner variant="warning" icon={AlertTriangle} dismissKey="demo-warning">Có 3 công nợ quá hạn 30 ngày.</Banner>
        <div style={{ height: 8 }} />
        <Banner variant="danger" icon={AlertCircle} dismissKey="demo-danger" action={<a href="#" style={{ color: 'inherit', textDecoration: 'underline' }}>Xử lý ngay</a>}>2 xe sắp hết hạn đăng kiểm.</Banner>
      </section>

      {/* T5 — Tabs */}
      <section>
        <h2 style={sectionH2}>T5 · Tabs</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={labelStyle}>boxed</div>
            <Tabs
              ariaLabel="Lọc theo trạng thái"
              variant="boxed"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'all', label: 'Tất cả', count: 42 },
                { id: 'open', label: 'Đang mở', count: 5 },
                { id: 'closed', label: 'Đã đóng', count: 37 },
              ]}
            />
          </div>
          <div>
            <div style={labelStyle}>bordered</div>
            <Tabs
              ariaLabel="Lọc theo trạng thái"
              variant="bordered"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'all', label: 'Tất cả', count: 42 },
                { id: 'open', label: 'Đang mở', count: 5 },
                { id: 'closed', label: 'Đã đóng' },
              ]}
            />
          </div>
          <div>
            <div style={labelStyle}>plain</div>
            <Tabs
              ariaLabel="Lọc theo trạng thái"
              variant="plain"
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'all', label: 'Tất cả' },
                { id: 'open', label: 'Đang mở' },
                { id: 'closed', label: 'Đã đóng' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* T2 — KPI with sparkline */}
      <section>
        <h2 style={sectionH2}>T2 · KPI with sparkline trend</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          <KPI
            label="Doanh thu tháng"
            value="2,4g"
            unit="₫"
            trend={{ data: [12, 18, 14, 22, 19, 26, 31], pct: 17, ariaLabel: 'Doanh thu 7 ngày gần nhất' }}
          />
          <KPI
            label="Chi phí"
            value="1,1g"
            unit="₫"
            trend={{ data: [10, 12, 9, 11, 8, 7, 6], pct: -3.2, ariaLabel: 'Chi phí 7 ngày gần nhất' }}
          />
          <KPI
            label="Số chuyến"
            value="42"
            // No trend — should render the watermark fallback if icon provided, else plain.
            assetIconName="truck"
          />
        </div>
        <div style={{ height: 16 }} />
        <div>
          <div style={labelStyle}>Sparkline standalone</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Sparkline data={[12, 18, 14, 22, 19, 26, 31]} variant="up" ariaLabel="Up trend" />
            <Sparkline data={[31, 26, 19, 22, 14, 18, 12]} variant="down" ariaLabel="Down trend" />
            <Sparkline data={[12, 14, 13, 15, 14, 16, 15]} variant="neutral" ariaLabel="Flat trend" />
          </div>
        </div>
      </section>

      {/* T1 — EmptyState variants */}
      <section>
        <h2 style={sectionH2}>T1 · EmptyState with placeholder previews</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
          <EmptyState
            title="Chưa có chuyến nào trong tháng"
            description="Bắt đầu bằng cách tạo chuyến mới. Danh sách sẽ hiển thị tại đây."
            preview="cards"
          />
          <EmptyState
            title="Không tìm thấy kết quả"
            description="Thử thay đổi bộ lọc hoặc từ khoá tìm kiếm."
            preview="rows"
          />
          <EmptyState
            title="Chưa có khách hàng"
            description="Thêm khách hàng đầu tiên để bắt đầu theo dõi công nợ."
            preview="list"
            icon={Plus}
          />
        </div>
      </section>

      {/* T4 — Command palette */}
      <section>
        <h2 style={sectionH2}>T4 · Command palette</h2>
        <p style={{ color: 'var(--ink-3)', marginTop: 0 }}>
          Press <kbd style={kbdStyle}>Ctrl</kbd>+<kbd style={kbdStyle}>K</kbd> or click below.
        </p>
        <button
          type="button"
          onClick={() => setShowPalette(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'var(--surface)', border: '1px solid var(--line-2)',
            padding: '8px 14px', borderRadius: 'var(--r-sm)', cursor: 'pointer',
            color: 'var(--ink-2)', fontFamily: 'inherit',
          }}
        >
          Mở bảng lệnh
        </button>
        <CommandPalette open={showPalette} commands={commands} onClose={() => setShowPalette(false)} />
      </section>
    </div>
  );
}

const sectionH2: CSSProperties = { fontSize: 'var(--fs-lg)', marginBottom: 12, color: 'var(--ink)' };
const labelStyle: CSSProperties = { fontSize: 'var(--fs-xs)', color: 'var(--ink-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' };
const kbdStyle: CSSProperties = {
  display: 'inline-block', padding: '2px 6px', borderRadius: 4,
  background: 'var(--surface-3)', border: '1px solid var(--line)',
  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-2)',
};
