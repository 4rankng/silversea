export interface ProfitPreviewState {
  tripCount?: number;
  distributions?: Array<unknown>;
  entity?: Array<unknown>;
  undistributedProfit?: number;
}

export function getProfitPreviewEmptyMessage(preview: ProfitPreviewState): string | null {
  const hasEntityRows = (preview.entity?.length ?? 0) > 0;
  const hasDistributionRows = (preview.distributions?.length ?? 0) > 0;
  if (hasEntityRows || hasDistributionRows) return null;

  if ((preview.tripCount ?? 0) === 0) {
    return 'Chưa có chuyến đã khóa trong quý này để phân phối.';
  }

  if ((preview.undistributedProfit ?? 0) > 0) {
    return 'Các chuyến trong quý chưa có cấu hình sở hữu xe hợp lệ nên chưa thể phân phối.';
  }

  return 'Chưa có dữ liệu phân phối cho quý đã chọn.';
}
