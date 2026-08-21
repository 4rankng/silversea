import { Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';

const DEFAULT_ADD_COUNT = 1;
const MAX_ADD_COUNT = 50;

interface ShipmentContainerEditorProps {
  rows: ReactNode;
  saving: boolean;
  onAdd: (count: number) => void;
}

/** Feature-local FCL editor shell for repeatable container records. */
export function ShipmentContainerEditor({ rows, saving, onAdd }: ShipmentContainerEditorProps) {
  const [addCount, setAddCount] = useState(String(DEFAULT_ADD_COUNT));
  const parsedAddCount = Number(addCount);
  const addCountIsValid = Number.isInteger(parsedAddCount)
    && parsedAddCount >= 1
    && parsedAddCount <= MAX_ADD_COUNT;

  return (
    <div className="csc-container-editor">
      <div className="csc-container-table-scroll">
        <table className="csc-container-table">
          <caption className="sr-only">Danh sách container</caption>
          <colgroup>
            <col className="csc-container-col__index" />
            <col className="csc-container-col__number" />
            <col className="csc-container-col__type" />
            <col className="csc-container-col__factory" />
            <col className="csc-container-col__route" />
            <col className="csc-container-col__pickup-port" />
            <col className="csc-container-col__dropoff-port" />
            <col className="csc-container-col__weight" />
            <col className="csc-container-col__appointment" />
            <col className="csc-container-col__actions" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">STT</th>
              <th scope="col">Số container</th>
              <th scope="col">Loại container</th>
              <th scope="col">Nhà máy</th>
              <th scope="col">Tuyến đường</th>
              <th scope="col">Cảng nâng</th>
              <th scope="col">Cảng hạ</th>
              <th scope="col">Trọng lượng (kg)</th>
              <th scope="col">Ngày giờ đóng trả</th>
              <th scope="col"><span className="sr-only">Thao tác</span></th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      <div className="csc-container-actions">
        <div className="csc-container-add-control">
          <input
            id="container-add-count"
            type="number"
            min="1"
            max={MAX_ADD_COUNT}
            step="1"
            inputMode="numeric"
            value={addCount}
            aria-label="Số container cần thêm"
            aria-invalid={!addCountIsValid}
            aria-describedby="container-add-count-hint"
            onChange={(event) => setAddCount(event.target.value)}
            disabled={saving}
          />
          <span id="container-add-count-hint" className="sr-only">
            Nhập từ 1 đến {MAX_ADD_COUNT} container.
          </span>
          <button
            type="button"
            className="csc-add-container"
            onClick={() => onAdd(parsedAddCount)}
            disabled={saving || !addCountIsValid}
          >
            <Plus size={16} aria-hidden="true" />
            <span>Thêm container</span>
          </button>
        </div>
      </div>
    </div>
  );
}
