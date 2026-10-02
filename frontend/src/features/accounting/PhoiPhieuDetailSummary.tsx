import { Money } from '../../components/shared/Money';

/**
 * The phơi-phiếu dialogs' footer totals band (card 20260928_171): the live
 * figures under both detail matrices. Both dialogs compute their totals from
 * rows + pending edits and hand them over here — the band only formats.
 *
 * Renders as a `region` named "Tổng cộng" so tests and screen readers can
 * read the dialog's money verdicts in one place; each item pairs its label
 * (dt) with the formatted amount (dd) in shared Money markup.
 */
export function PhoiPhieuDetailSummary({ items }: {
  items: Array<{ label: string; amount: number }>;
}) {
  return (
    <dl className="phoi-detail-summary" role="region" aria-label="Tổng cộng">
      {items.map((item) => (
        <div key={item.label} className="phoi-detail-summary__item">
          <dt>{item.label}</dt>
          <dd><Money value={item.amount} /></dd>
        </div>
      ))}
    </dl>
  );
}
