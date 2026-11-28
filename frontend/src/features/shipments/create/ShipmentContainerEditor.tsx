import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NumberField } from '../../../design-system';

const DEFAULT_ADD_COUNT = 1;
const MAX_ADD_COUNT = 50;

interface ShipmentContainerEditorProps {
  rows: ReactNode;
  saving: boolean;
  onAdd: (count: number) => void;
  viewMode?: boolean;
  /** P2-19 (audit 2026-11-27): the trailing actions column (col + th) renders
   *  only when it can hold a control — an edit-mode surface, or more than one
   *  container row. Same condition the row's own actions td uses. */
  isEditMode?: boolean;
  containersLength?: number;
  /** SIL-1156 (HOT-01, KB K3.23 §3.2.3): Lệnh chạy ngoài waives exactly
   *  Nhà máy + Tuyến đường — the header stars must match the cell labels and
   *  the readiness chip (Bắt buộc: 0/7), so the two waived thead marks drop
   *  while the ports + appointment marks stay. */
  isAdHoc?: boolean;
}

/** Feature-local FCL editor shell for repeatable container records. */
export function ShipmentContainerEditor({ rows, saving, onAdd, viewMode = false, isEditMode = false, containersLength = 0, isAdHoc = false }: ShipmentContainerEditorProps) {
  const [addCount, setAddCount] = useState<number | ''>(DEFAULT_ADD_COUNT);
  const addCountIsValid = typeof addCount === 'number'
    && Number.isInteger(addCount)
    && addCount >= 1
    && addCount <= MAX_ADD_COUNT;

  return (
    <div className="csc-container-editor">
      <div className="csc-container-table-scroll">
        <table className="csc-container-table">
          <caption className="sr-only">Danh sách container</caption>
          <colgroup>
            <col className="csc-container-col__index" />
            <col className="csc-container-col__contgroup" />
            {/* SIL-701/SIL-600: số tờ khai rides right after the container
                identity group — the CUS Thông tin hàng sheet's column order. */}
            <col className="csc-container-col__declaration" />
            <col className="csc-container-col__factory" />
            <col className="csc-container-col__route" />
            <col className="csc-container-col__pickup-port" />
            <col className="csc-container-col__dropoff-port" />
            <col className="csc-container-col__appointment" />
            {!viewMode && (isEditMode || containersLength > 1) && <col className="csc-container-col__actions" />}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">STT</th>
              <th scope="col">Số container</th>
              <th scope="col">Số tờ khai</th>
              <th scope="col">Nhà máy{isAdHoc ? '' : <> <span className="csc-req" aria-hidden="true">*</span></>}</th>
              <th scope="col">Tuyến đường{isAdHoc ? '' : <> <span className="csc-req" aria-hidden="true">*</span></>}</th>
              <th scope="col">Cảng nâng <span className="csc-req" aria-hidden="true">*</span></th>
              <th scope="col">Cảng hạ <span className="csc-req" aria-hidden="true">*</span></th>
              <th scope="col">Ngày giờ đóng trả <span className="csc-req" aria-hidden="true">*</span></th>
              {/* SIL-1304 — cột xóa có tiêu đề HIỂN THỊ ('Xóa' — trước chỉ có
                  span sr-only nên hàng tiêu đề để trống ô cuối). */}
              {!viewMode && (isEditMode || containersLength > 1) && <th scope="col">Xóa</th>}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      {!viewMode && (
        <div className="csc-container-actions">
          <div className="csc-container-add-control" title="Số dòng container thêm cùng lúc">
            <label htmlFor="container-add-count" className="csc-container-add-label">SL</label>
            <NumberField
              id="container-add-count"
              min={1}
              max={MAX_ADD_COUNT}
              step={1}
              value={addCount}
              aria-label="Số container cần thêm"
              aria-invalid={!addCountIsValid}
              aria-describedby="container-add-count-hint"
              onChange={setAddCount}
              disabled={saving}
            />
            <span id="container-add-count-hint" className="sr-only">
              Nhập từ 1 đến {MAX_ADD_COUNT} container.
            </span>
            <button
              type="button"
              className="csc-add-container"
              onClick={() => { if (addCountIsValid && typeof addCount === 'number') onAdd(addCount); }}
              disabled={saving || !addCountIsValid}
            >
              <Plus size={16} aria-hidden="true" />
              <span>Thêm container</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
