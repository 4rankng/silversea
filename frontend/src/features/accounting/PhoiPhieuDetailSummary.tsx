import { Money } from '../../components/shared/Money';
import '../../design-system/SummaryRail.css';

/** The house ruled summary anatomy; calculations remain in the owning dialog. */
export function PhoiPhieuDetailSummary({ items }: { items: { label: string; amount: number }[] }) {
  return (
    <section className="summary-rail" aria-label="Tổng cộng">
      <dl>
        {items.map(({ label, amount }) => (
          <div className="summary-rail__item" key={label}>
            <dt>{label}</dt>
            <dd><Money value={amount} /></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
