import { useState, useRef, useEffect } from 'react';
import { api, fileCommandFingerprint } from '../../lib/api';
import { useToast } from '../../components/shared/Toast';
import { EXPENSE_PHOTO_MAX_BYTES, convertHeicToJpeg } from './expense-photo-utils';

/** Receipt selection is local until the expense exists. A partial upload retry keeps that saved ID. */
export function useExpenseReceiptPhotos(id: string | undefined, savedExpenseId: number | null) {
  const { toast } = useToast();
  const [photoError, setPhotoError] = useState('');
  const [photos, setPhotos] = useState<{ id: number; url: string; file?: File }[]>([]);
  const pendingPhotoSequence = useRef(0);
  const pendingUrls = useRef(new Set<string>());
  useEffect(() => () => { pendingUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const [uploading, setUploading] = useState(false);
  // B1: load persisted receipt photos when editing (photos attach to the saved row).
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    api.get<{ items: Array<{ id: number; storageKey: string }> }>(`/expenses/${id}/photos`)
      .then(res => {
        if (cancelled) return;
        setPhotos(res.items.map(p => ({ id: p.id, url: `/api/photos/${encodeURIComponent(p.storageKey)}` })));
      })
      .catch(() => { if (!cancelled) setPhotoError('Không tải được ảnh chứng từ. Tải lại trang để kiểm tra ảnh đã lưu.'); });
    return () => { cancelled = true; };
  }, [id]);

  const handlePhotoUpload = async (files: FileList) => {
    if (!files || files.length === 0) return;
    let file = files[0];

    // D1b: client-side size guard — matches the raised 15 MB backend limit so
    // the user gets a clear message instead of a opaque multer failure.
    if (file.size > EXPENSE_PHOTO_MAX_BYTES) {
      toast({ kind: 'error', message: 'Ảnh quá lớn (>15 MB). Vui lòng giảm dung lượng rồi tải lại.' });
      return;
    }

    // D1b: convert HEIC (iPhone) → JPEG on the client; the server has no HEIC codec.
    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || /\.(heic|heif)$/i.test(file.name);
    if (isHeic) {
      try {
        file = await convertHeicToJpeg(file);
      } catch (err) {
        console.warn('HEIC→JPEG conversion failed:', err instanceof Error ? err.message : err);
        toast({ kind: 'error', message: 'Không hỗ trợ ảnh HEIC trên trình duyệt này. Vui lòng đổi sang JPG/PNG.' });
        return;
      }
    }

    if (!id && !savedExpenseId) {
      const url = URL.createObjectURL(file);
      pendingUrls.current.add(url);
      setPhotos(prev => [...prev, { id: --pendingPhotoSequence.current, url, file }]);
      return;
    }
    const targetId = id ?? savedExpenseId;
    const formData = new FormData();
    formData.append('file', file);
    const retryFingerprint = [
      'expense-entry-photo',
      fileCommandFingerprint(file),
      targetId,
    ].join(':');

    setUploading(true);
    try {
      const result = await api.upload(`/expenses/${targetId}/photos`, formData, { retryFingerprint }) as { id: number; url: string };
      setPhotos(prev => [...prev, result]);
    } catch {
      toast({ kind: 'error', message: 'Lỗi khi tải ảnh. Vui lòng thử lại.' });
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async (index: number) => {
    const photo = photos[index];
    if (!photo) return;
    if (photo.file) {
      URL.revokeObjectURL(photo.url);
      pendingUrls.current.delete(photo.url);
      setPhotos(prev => prev.filter(item => item.id !== photo.id));
      return;
    }
    const targetId = id ?? savedExpenseId;
    if (!targetId) return;
    try {
      await api.delete(`/expenses/${targetId}/photos/${photo.id}`);
      // Filter by id, not the captured index: if two deletes are in flight the
      // second's stale index would otherwise drop the wrong thumbnail.
      setPhotos(prev => prev.filter(p => p.id !== photo.id));
    } catch {
      toast({ kind: 'error', message: 'Không xóa được ảnh.' });
    }
  };

  const savePendingPhotos = async (expenseId: number) => {
        for (const photo of photos.filter(item => item.file)) {
          const body = new FormData();
          body.append('file', photo.file!);
          try {
            const uploaded = await api.upload(`/expenses/${expenseId}/photos`, body, { retryFingerprint: `expense-entry-photo:${fileCommandFingerprint(photo.file!)}:${expenseId}` }) as { id: number; url: string };
            setPhotos(previous => previous.map(item => item.id === photo.id ? uploaded : item));
            URL.revokeObjectURL(photo.url);
            pendingUrls.current.delete(photo.url);
          } catch {
            throw new Error('Chi phí đã được ghi nhận, nhưng còn ảnh chưa tải được. Bấm Lưu chi phí để tải lại ảnh còn thiếu; hệ thống không tạo thêm phiếu.');
          }
        }
  };
  return { photos, uploading, photoError, handlePhotoUpload, removePhoto, savePendingPhotos };
}
