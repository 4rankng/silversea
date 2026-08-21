import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { CrudTable } from '../../components/config/CrudTable';
import { Field } from '../../components/config/Field';
import { FormActions } from '../../components/config/FormActions';
import { InlineForm } from '../../components/config/InlineForm';
import { usePageAnimations } from '../../hooks/animations';
import { DateInput } from '../../design-system/forms/DateInput';

interface BusinessCalendarDay {
  id: number;
  calendarDate: string;
  name: string;
  isWorkingDay: boolean;
}

function BusinessCalendarForm({
  item,
  saving,
  onsave,
  oncancel,
}: {
  item?: BusinessCalendarDay;
  saving: boolean;
  onsave: (data: Record<string, unknown>) => void;
  oncancel: () => void;
}) {
  const [calendarDate, setCalendarDate] = useState(item?.calendarDate ?? '');
  const [name, setName] = useState(item?.name ?? '');
  const [isWorkingDay, setIsWorkingDay] = useState(item?.isWorkingDay ?? false);

  return (
    <InlineForm colSpan={4}>
      <div style={{ minWidth: 170 }}>
        <Field label="Ngày">
          <DateInput
            className="input"
            value={calendarDate}
            onChange={setCalendarDate}
          />
        </Field>
      </div>
      <div style={{ flex: 2, minWidth: 220 }}>
        <Field label="Tên ngày nghỉ / ngày làm bù">
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ví dụ: Quốc khánh"
          />
        </Field>
      </div>
      <label
        style={{
          display: 'flex',
          minHeight: 44,
          alignItems: 'center',
          gap: 9,
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        <input
          type="checkbox"
          checked={isWorkingDay}
          onChange={(event) => setIsWorkingDay(event.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        Ngày làm việc bù
      </label>
      <FormActions
        saving={saving}
        isedit={!!item}
        oncancel={oncancel}
        onsave={() => {
          if (!calendarDate || !name.trim()) return;
          onsave({ calendarDate, name: name.trim(), isWorkingDay });
        }}
      />
    </InlineForm>
  );
}

export default function BusinessCalendarConfigPage() {
  const { rootRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={rootRef}>
      <div className="notice notice--info" style={{ marginBottom: 16 }}>
        <CalendarDays size={18} aria-hidden="true" />
        <span>
          Thứ Hai–Thứ Sáu mặc định là ngày làm việc. Thêm ngày nghỉ hoặc đánh dấu
          ngày cuối tuần làm bù; hạn xử lý sẽ dùng lịch này trừ khi hợp đồng khách
          hàng chọn giữ nguyên ngày lịch.
        </span>
      </div>
      <CrudTable<BusinessCalendarDay>
        title="Lịch ngày làm việc"
        description="Ngày nghỉ lễ và ngày làm việc bù dùng chung cho hạn thanh toán, quá hạn và lịch nhắc"
        endpoint="/business-calendar"
        listQuery="?limit=500"
        sortFn={(left, right) => left.calendarDate.localeCompare(right.calendarDate)}
        colSpan={4}
        pageSlug="business-calendar"
        iconName="salary-period"
        emptyTitle="Chưa có ngoại lệ lịch làm việc"
        emptyHint="Cuối tuần vẫn được tự động loại trừ. Chỉ thêm ngày lễ hoặc ngày làm việc bù."
        columns={[
          {
            header: 'Ngày',
            render: (row) => (
              <time dateTime={row.calendarDate} style={{ fontWeight: 700 }}>
                {new Date(`${row.calendarDate}T00:00:00`).toLocaleDateString('vi-VN')}
              </time>
            ),
          },
          {
            header: 'Tên',
            render: (row) => <span>{row.name}</span>,
          },
          {
            header: 'Quy tắc',
            render: (row) => (
              <span className={`pill ${row.isWorkingDay ? 'pill--success' : 'pill--neutral'}`}>
                <span className="dot" />
                {row.isWorkingDay ? 'Ngày làm việc bù' : 'Ngày nghỉ'}
              </span>
            ),
          },
        ]}
        renderForm={(props) => (
          <BusinessCalendarForm
            item={props.item}
            saving={props.saving}
            onsave={props.onSave}
            oncancel={props.onCancel}
          />
        )}
      />
    </div>
  );
}
