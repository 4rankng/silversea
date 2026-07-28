export type FormState = {
  expenseDate: string;
  supplierId: number | '';
  categoryId: number | '';
  truckId: number | '';
  vehicleComponent: 'TRUCK' | 'TRAILER';
  amount: string;
  paymentStatus: 'PAID' | 'UNPAID';
  validFrom: string;
  validTo: string;
  receiptId: string;
  note: string;
};

export const initialForm: FormState = {
  expenseDate: new Date().toISOString().slice(0, 10),
  supplierId: '',
  categoryId: '',
  truckId: '',
  vehicleComponent: 'TRUCK' as const,
  amount: '',
  paymentStatus: 'UNPAID',
  validFrom: '',
  validTo: '',
  receiptId: '',
  note: '',
};

// D1b: matches the backend multer limit (raised from 5 MB → 15 MB).
export const EXPENSE_PHOTO_MAX_BYTES = 15 * 1024 * 1024;

export function expenseSubmissionMessage(
  isEdit: boolean,
  response: Record<string, unknown>,
): string {
  if (!isEdit) {
    return 'Đã gửi yêu cầu ghi nhận chi phí vào hàng chờ kiểm tra. Chưa phát sinh công nợ phải trả.';
  }
  const deltaSnapshot = response.deltaSnapshot as Record<string, unknown> | undefined;
  if (
    response.actionKind === 'COMPANY_EXPENSE'
    && deltaSnapshot?.applicationMode === 'FINALIZED_REPLACEMENT'
  ) {
    return 'Đã gửi điều chỉnh chi phí đã quyết toán vào hàng chờ. Phiếu gốc chưa thay đổi; sau phê duyệt hệ thống sẽ lưu một bản thay thế và giữ nguyên lịch sử.';
  }
  return response.actionKind === 'COMPANY_EXPENSE'
    ? 'Đã gửi thay đổi chi phí vào hàng chờ kiểm tra. Chưa cập nhật công nợ.'
    : 'Đã cập nhật thông tin không ảnh hưởng công nợ.';
}

// D1b: iOS Safari saves photos as HEIC, which the server's libvips cannot
// decode. Safari decodes HEIC natively, so convert to JPEG on the client via
// <img>→canvas before upload. Browsers that can't decode HEIC (e.g. Chrome on
// desktop) reject in the catch below with a clear message instead of a 500.
export async function convertHeicToJpeg(file: File): Promise<File> {
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('read'));
    reader.readAsDataURL(file);
  });
  const img: HTMLImageElement = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('decode'));
    i.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  // Cap dimensions so a large iPhone HEIC doesn't blow up canvas memory (a
  // 12MP photo is ~49MB of RGBA); 2560px matches the server's MAX_IMAGE_DIMENSION.
  const MAX_DIM = 2560;
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('encode');
  return new File([blob], file.name.replace(/\.(heic|heif)$/i, '.jpg'), { type: 'image/jpeg' });
}
