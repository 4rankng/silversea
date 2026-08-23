/**
 * Design system barrel.
 *
 * Import surface for the consolidated UI primitives. Pages should prefer
 * importing from here rather than reaching into `components/UI` directly.
 *
 *   import { DataTable, Pagination, TextField, useDebouncedValue, useTableQueryState } from '@/design-system';
 */
export * from './hooks/useDebouncedValue';
export * from './hooks/useAuthedQuery';
export * from './hooks/useMonthRoute';
export * from './hooks/useTableQueryState';
export * from './hooks/useSalaryPeriod';
export * from './hooks/useMonthlyQuery';
export * from './hooks/useBufferedDateValue';

export { Pagination } from './Pagination';
export type { PaginationProps } from './Pagination';
export { DataTable } from './DataTable';

export { SummaryRail } from './SummaryRail';
export type { SummaryRailItem, SummaryRailTone } from './SummaryRail';
export type { DataTableProps, DataTableColumn } from './DataTable';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps, EmptyStatePreview } from './EmptyState';
// T2 (Tailkit a-c-statistics-11 pattern, hand-rolled SVG, no chart dep).
export { Sparkline } from './Sparkline';
export type { SparklineProps, SparklineVariant } from './Sparkline';
// T5 (daisyUI-native, DRYs inline `role="tab"` markup across 5 pages).
export { Tabs } from './Tabs';
export type { TabsProps, TabsVariant, TabItem } from './Tabs';

export { TextField } from './forms/TextField';
export type { TextFieldProps, BaseFieldProps } from './forms/TextField';
export { SelectField } from './forms/SelectField';
export type { SelectFieldProps } from './forms/SelectField';
export { UuiSelectField } from './forms/UuiSelectField';
export type { UuiSelectFieldProps } from './forms/UuiSelectField';
export { SearchableSelect } from './forms/SearchableSelect';
export type { SearchableSelectOption, SearchableSelectProps } from './forms/SearchableSelect';
export { NumberField } from './forms/NumberField';
export type { NumberFieldProps } from './forms/NumberField';
export { DateField } from './forms/DateField';
export type { DateFieldProps } from './forms/DateField';
export { DateInput } from './forms/DateInput';
export type { DateInputProps } from './forms/DateInput';
export { BufferedUuiDateInput } from './forms/BufferedUuiDateInput';
export type { BufferedUuiDateInputProps } from './forms/BufferedUuiDateInput';
