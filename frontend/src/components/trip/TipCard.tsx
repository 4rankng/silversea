import React from 'react';
import './TipCard.css';
import { Info } from 'lucide-react';

export function TipCard() {
  return (
    <div className="tc-tip-card">
      <span className="tc-tip-card__ico"><Info size={16} /></span>
      <div>
        <strong>Mẹo:</strong> Chọn <strong>tuyến đường</strong> để tự động điền số trạm thu phí, định mức dầu và lương sản lượng từ cấu hình tuyến.
      </div>
    </div>
  );
}
