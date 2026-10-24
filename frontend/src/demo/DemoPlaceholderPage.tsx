/**
 * Shared placeholder page for the six demo routes (SIL-155): title + scope
 * from the spec + skeleton of the surface the next lane builds. Keeps every
 * demo route visually one family while the real screens land lane by lane.
 */
import type { DemoNavItem } from './nav';

const SKELETON_BAR_WIDTHS = ['w-16', 'w-28', 'w-20', 'w-24', 'w-14', 'w-22'] as const;

function SkeletonKpiRow() {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="rounded-xl border border-secondary_alt bg-primary p-4 shadow-xs">
          <div className="h-3.5 w-20 animate-pulse rounded-md bg-tertiary" />
          <div className="mt-3 h-7 w-24 animate-pulse rounded-md bg-tertiary" />
        </div>
      ))}
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="rounded-xl border border-secondary_alt bg-primary shadow-xs">
      <div className="flex gap-4 border-b border-secondary_alt px-4 py-3">
        {SKELETON_BAR_WIDTHS.map((w, i) => (
          <div key={i} className={`h-3 ${w} animate-pulse rounded-md bg-tertiary`} />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, row) => (
        <div
          key={row}
          className="flex items-center gap-4 border-b border-secondary_alt px-4 py-3.5 last:border-b-0"
        >
          {SKELETON_BAR_WIDTHS.map((w, i) => (
            <div key={i} className={`h-3.5 ${w} animate-pulse rounded-md bg-secondary_alt`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DemoPlaceholderPage({ item }: { item: DemoNavItem }) {
  return (
    <div className="flex flex-col gap-6" data-testid="demo-placeholder-page">
      <header className="flex flex-wrap items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-brand-700">
          <item.icon className="size-6" />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-display-xs font-semibold text-primary">{item.heading}</h1>
          <p className="max-w-[72ch] text-md text-tertiary">{item.description}</p>
        </div>
      </header>

      <section className="rounded-xl border border-secondary_alt bg-primary p-5 shadow-xs">
        <h2 className="text-sm font-semibold text-primary">Nội dung lane kế tiếp xây tại đây</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {item.upcoming.map((line) => (
            <li key={line} className="flex items-start gap-2.5 text-sm text-secondary">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      </section>

      <div aria-hidden="true" className="flex flex-col gap-4">
        <SkeletonKpiRow />
        <SkeletonTable />
      </div>

      <p className="text-sm text-quaternary">
        Trang demo — dữ liệu tĩnh từ <code>frontend/src/demo/data</code>, không gọi API.
      </p>
    </div>
  );
}
