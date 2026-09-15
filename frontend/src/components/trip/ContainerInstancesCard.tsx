import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Plus, Trash2, Camera, ImageOff, X } from "lucide-react";
import { api } from "../../lib/api";
import { photoSrc } from "../../lib/api/photo";
import { useToast } from "../shared/Toast";
import { qk } from "../../api/keys";
import { useTripFormContext } from "../../hooks/useTripFormContext";
import type { SealFormRow } from "../../hooks/useTripFormState";
import { ContainerScanner, dataUrlToFile } from "../shared/ContainerScanner";
import { PhotoViewer } from "../PhotoViewer";
import "./ContainerInstancesCard.css";



interface Props {

  tripId?: number;

  expectedCount?: number;

  requiresPhotos?: boolean;
}
import { checkContainerNumber, emptyRow, emptySeal, hasEditableContainerData, photoStorageKey, rowKey, sealKey, type ContainerRow, type ServerContainer } from "./container-instance-helpers";

export function ContainerInstancesCard({ tripId, expectedCount = 1, requiresPhotos }: Props) {
  const { toast } = useToast();
  const { ocrResult, containerRows: rows, setContainerRows: setRows, uploadContainerPhoto, revokeRowPhotos, revokeContainerPhoto, plannedContainerTypeId } = useTripFormContext();
  const plannedTypeValue = plannedContainerTypeId ? Number(plannedContainerTypeId) : "";
  const seededTripRef = useRef<number | null>(null);
  const createSeededRef = useRef(false);

  const [scanner, setScanner] = useState<{ rowKey: string; type: "CONTAINER" | "SEAL"; sealIndex?: 0 | 1 } | null>(null);
  const [uploading, setUploading] = useState<Record<string, { cont: boolean; seal: boolean }>>({});
  const [deletingPhotos, setDeletingPhotos] = useState<Record<string, { cont: boolean; seal: boolean }>>({});
  const [failedPhotos, setFailedPhotos] = useState<Record<string, boolean>>({});
  const [lightbox, setLightbox] = useState<{ rowKey: string; type: "CONTAINER" | "SEAL"; urls: string[]; index: number } | null>(null);

  const consumedNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!ocrResult) return;
    if (ocrResult.nonce === consumedNonceRef.current) return;
    consumedNonceRef.current = ocrResult.nonce;

    const hasContainers = ocrResult.containerNumbers.length > 0;
    const hasSeal = !!ocrResult.sealNumber;
    if (!hasContainers && !hasSeal) return;

    setRows((prev) => {
      const next = prev.map((r) => ({ ...r }));
      for (const value of ocrResult.containerNumbers) {
        let slot = next.find((r) => !r.containerNumber.trim());
        if (!slot) {
          slot = emptyRow(plannedTypeValue);
          next.push(slot);
        }
        slot.containerNumber = value;
      }
      if (hasSeal) {
        const sn = ocrResult.sealNumber!;
        if (!next.length) next.push(emptyRow(plannedTypeValue));
        const target = next[0];
        const slotIndex = target.seals.findIndex((sl) => !sl.sealNumber.trim());
        const sealIndex = slotIndex >= 0 && slotIndex < 2 ? slotIndex : Math.min(target.seals.length, 1);
        const seals = [...target.seals];
        const seal = seals[sealIndex] ?? emptySeal();
        seals[sealIndex] = { ...seal, sealNumber: sn.toUpperCase() };
        target.seals = seals.slice(0, 2);
        target.sealNumber = target.seals[0]?.sealNumber ?? "";
      }
      return next;
    });
    toast({ kind: "info", message: "Đã nhận diện số cont/seal — xem lại trước khi lưu." });
  }, [ocrResult, plannedTypeValue, setRows, toast]);

  const { data: existing, isLoading } = useQuery<{
    items: ServerContainer[];
    contPhotoKey?: string | null;
    sealPhotoKey?: string | null;
    contPhotoKeys?: string[];
    sealPhotoKeys?: string[];
  }>({
    queryKey: qk.tripForm.tripContainers(tripId ?? 0),
    queryFn: () => api.get(`/trips/${tripId}/containers`),
    enabled: !!tripId,
  });

  useEffect(() => {
    if (!tripId) {
      if (createSeededRef.current) return;
      createSeededRef.current = true;
      setRows((prev) => (prev.length > 0 ? prev : Array.from({ length: expectedCount }, () => emptyRow(plannedTypeValue))));
      return;
    }
    if (!existing) return;
    if (seededTripRef.current === tripId) return;
    seededTripRef.current = tripId;
    const fromServer: ContainerRow[] = (existing.items || []).map((c) => {
      let seals: SealFormRow[];
      if (c.seals && c.seals.length > 0) {
        seals = c.seals.slice(0, 2).map((seal) => ({
          id: seal.id,
          _key: sealKey(),
          sealNumber: seal.sealNumber,
          sealType: seal.sealType ?? "",
          notes: seal.notes ?? "",
        }));
      } else if (c.sealNumber) {
        seals = [{ _key: sealKey(), sealNumber: c.sealNumber, sealType: "", notes: "" }];
      } else {
        seals = [];
      }
      const photos = c.photos ?? [];
      const photoKeys = {
        cont: photos.filter((p) => p.type === "CONTAINER").map((p) => p.storageKey),
        seal: photos.filter((p) => p.type === "SEAL").map((p) => p.storageKey),
      };
      return {
        id: c.id,
        _key: rowKey(),
        containerTypeId: c.containerTypeId ?? "",
        containerNumber: c.containerNumber ?? "",
        sealNumber: seals[0]?.sealNumber ?? "",
        cargoWeightKg: c.cargoWeightKg != null ? String(c.cargoWeightKg) : "",
        notes: c.notes ?? "",
        seals,
        photoKeys,
      };
    });
    while (fromServer.length < expectedCount) {
      fromServer.push(emptyRow(plannedTypeValue));
    }
    setRows(fromServer);
  }, [existing, expectedCount, plannedTypeValue, tripId, setRows]);

  useEffect(() => {
    if (tripId || !createSeededRef.current) return;
    setRows((prev) => {
      const next = [...prev];
      while (next.length < expectedCount) {
        next.push(emptyRow(plannedTypeValue));
      }
      while (next.length > expectedCount && !hasEditableContainerData(next[next.length - 1])) {
        next.pop();
      }
      return next.length === prev.length ? prev : next;
    });
  }, [expectedCount, plannedTypeValue, tripId, setRows]);

  useEffect(() => {
    if (!plannedContainerTypeId) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.containerTypeId) return r;
        return { ...r, containerTypeId: Number(plannedContainerTypeId) };
      }),
    );
  }, [plannedContainerTypeId, setRows]);

  useEffect(() => {
    if (!rows.some((r) => r.seals.length > 2)) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.seals.length <= 2) return r;
        const seals = r.seals.slice(0, 2);
        return {
          ...r,
          seals,
          sealNumber: seals[0]?.sealNumber ?? "",
        };
      }),
    );
  }, [rows, setRows]);

  const updateRow = (key: string, field: keyof ContainerRow, value: string | number) => {
    setRows((prev) => prev.map((r) => (r._key === key ? { ...r, [field]: value } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow(plannedTypeValue)]);

  const removeRow = (key: string) => {
    revokeRowPhotos(key);
    setRows((prev) => prev.filter((r) => r._key !== key));
  };

  const updateSeal = (rowKeyValue: string, index: 0 | 1, field: "sealNumber" | "sealType" | "notes", value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r._key !== rowKeyValue) return r;
        const seals = [...r.seals];
        const seal = seals[index] ?? emptySeal();
        seals[index] = { ...seal, [field]: value };
        return { ...r, seals, sealNumber: seals[0]?.sealNumber ?? "" };
      }),
    );
  };

  const clearSeal = (rowKeyValue: string, index: 0 | 1) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r._key !== rowKeyValue) return r;
        const seals = [...r.seals];
        seals[index] = emptySeal();
        return { ...r, seals, sealNumber: index === 0 ? "" : (seals[0]?.sealNumber ?? "") };
      }),
    );
  };

  const renderPhotoLane = (row: ContainerRow, pType: "CONTAINER" | "SEAL", sealIndex?: 0 | 1) => {
    const field = pType === "CONTAINER" ? "cont" : "seal";
    const title = pType === "CONTAINER" ? "Ảnh container" : `Ảnh seal ${(sealIndex ?? 0) + 1}`;
    const allUrls = row.photoKeys[field];
    const sealUrl = pType === "SEAL" && sealIndex != null ? allUrls[sealIndex] : undefined;
    const urls = pType === "SEAL" ? (sealUrl ? [sealUrl] : []) : allUrls.filter(Boolean).slice(-1);
    const isUploading = uploading[row._key]?.[field] ?? false;
    const isDeleting = deletingPhotos[row._key]?.[field] ?? false;
    const busy = isUploading || isDeleting;
    const isCont = pType === "CONTAINER";
    const busyMessage = isDeleting ? `Đang xoá ${title.toLowerCase()}…` : isUploading ? `Đang tải ${title.toLowerCase()}…` : null;
    return (
      <div className="ci-photo-lane" data-state={urls.length > 0 ? "ready" : "empty"}>
        <div className="ci-photo-lane__copy">
          <span className="ci-photo-lane__title">{title}</span>
          <span className="ci-photo-lane__hint">
            {urls.length > 0 ? "Nhấn ảnh để xem lớn" : "Chưa có ảnh bằng chứng"}
          </span>
        </div>
        <div className="ci-photo-lane__media" aria-busy={busy}>
          {urls.length === 0 ? (
            <span className="ci-photo-empty" aria-hidden="true">
              <ImageOff size={16} />
            </span>
          ) : (
            <>
              {urls.map((u, uIdx) => {
                const isPending = u.startsWith("blob:");
                const hasLoadError = failedPhotos[u] ?? false;
                return (
                  <span key={`${u}-${uIdx}`} className="ci-photo-slot">
                    <button
                      type="button"
                      className="ci-photo-slot__view"
                      disabled={busy || hasLoadError}
                      onClick={(event) => {
                        event.stopPropagation();
                        setLightbox({
                          rowKey: row._key,
                          type: pType,
                          urls: urls.map(photoSrc),
                          index: uIdx,
                        });
                      }}
                      aria-label={isCont ? "Mở ảnh container" : `Mở ảnh seal ${(sealIndex ?? 0) + 1}`}
                    >
                      {hasLoadError ? (
                        <span className="ci-photo-slot__error" role="status">
                          <ImageOff size={16} aria-hidden="true" />
                          <span>Không tải được</span>
                        </span>
                      ) : (
                        <img
                          src={photoSrc(u)}
                          alt={`${title}${row.containerNumber ? ` ${row.containerNumber}` : ""}`}
                          loading="lazy"
                          onError={() => setFailedPhotos((prev) => ({ ...prev, [u]: true }))}
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      className="ci-photo-slot__remove"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void removePhotoFromRow(row, pType, u);
                      }}
                      aria-label={isCont ? "Xoá ảnh container" : `Xoá ảnh seal ${(sealIndex ?? 0) + 1}`}
                      title={isCont ? "Xoá ảnh container" : `Xoá ảnh seal ${(sealIndex ?? 0) + 1}`}
                    >
                      {deletingPhotos[row._key]?.[field] ? <Loader2 size={11} className="spin" /> : <X size={11} />}
                    </button>
                    {isPending && (
                      <span className="ci-photo-slot__pending" role="status" aria-live="polite" title="Chưa lưu — sẽ tải lên khi biểu mẫu được gửi (Tạo lệnh hoặc Lưu cập nhật)">
                        chưa lưu
                      </span>
                    )}
                  </span>
                );
              })}
            </>
          )}
        </div>
        <button
          type="button"
          className="ci-photo-lane__capture"
          disabled={busy}
          onClick={() => setScanner({ rowKey: row._key, type: pType, sealIndex })}
          aria-label={
            busyMessage ??
            (urls.length > 0
              ? isCont
                ? "Đổi ảnh container"
                : `Đổi ảnh seal ${(sealIndex ?? 0) + 1}`
              : isCont
                ? "Chụp ảnh container"
                : `Chụp ảnh seal ${(sealIndex ?? 0) + 1}`)
          }
        >
          {busy ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
          <span>{busy ? "Đang xử lý…" : urls.length > 0 ? "Đổi ảnh" : "Chụp ảnh"}</span>
        </button>
        {busyMessage && (
          <span className="ci-visually-hidden" role="status" aria-live="polite">
            {busyMessage}
          </span>
        )}
      </div>
    );
  };

  const deletePersistedPhoto = async (row: ContainerRow, type: "CONTAINER" | "SEAL", url: string) => {
    if (!tripId || !row.id || url.startsWith("blob:")) return;
    const res = await api.post<{ ok: boolean; removed?: number }>(`/upload/trips/${tripId}/photos/${type.toLowerCase()}/delete`, { container_id: row.id, storage_key: photoStorageKey(url) });
    if (!res?.removed) throw new Error("photo not found on server");
  };


  const handleCapture = async (dataUrl: string) => {
    const target = scanner;
    if (!target) return;
    const row = rows.find((r) => r._key === target.rowKey);
    if (!row) {
      setScanner(null);
      return;
    }
    const field = target.type === "CONTAINER" ? "cont" : "seal";
    const sealIndex = target.sealIndex ?? 0;
    const previousSealUrl = target.type === "SEAL" ? row.photoKeys.seal[sealIndex] : undefined;
    const previousUrls = previousSealUrl ? [previousSealUrl] : row.photoKeys.cont.filter(Boolean).slice(-1);
    setScanner(null);
    setUploading((prev) => ({
      ...prev,
      [target.rowKey]: { ...(prev[target.rowKey] ?? { cont: false, seal: false }), [field]: true },
    }));
    try {
      const file = dataUrlToFile(dataUrl);
      const { url, ocrResult: ocr, pending } = await uploadContainerPhoto(file, tripId, target.rowKey, target.type, row.id);
      setFailedPhotos((prev) => {
        const next = { ...prev };
        delete next[url];
        for (const oldUrl of previousUrls) delete next[oldUrl];
        return next;
      });
      for (const oldUrl of previousUrls) {
        if (oldUrl.startsWith("blob:")) revokeContainerPhoto(row._key, target.type, oldUrl);
      }
      setRows((prev) =>
        prev.map((r) => {
          if (r._key !== target.rowKey) return r;
          if (target.type === "SEAL") {
            const sealPhotos = [...r.photoKeys.seal];
            while (sealPhotos.length <= sealIndex) sealPhotos.push("");
            sealPhotos[sealIndex] = url;
            return { ...r, photoKeys: { ...r.photoKeys, seal: sealPhotos } };
          }
          return { ...r, photoKeys: { ...r.photoKeys, cont: [url] } };
        }),
      );
      for (const oldUrl of previousUrls) {
        if (!oldUrl.startsWith("blob:")) {
          deletePersistedPhoto(row, target.type, oldUrl).catch(() => {
            toast({ kind: "error", message: "Ảnh cũ chưa xoá được — thử xoá lại nếu còn hiện." });
          });
        }
      }
      if (target.type === "CONTAINER") {
        const cn = ocr.containerNumbers?.[0];
        if (cn) updateRow(target.rowKey, "containerNumber", cn.toUpperCase());
        toast({
          kind: cn ? "info" : "error",
          message: cn ? "Đã nhận diện số cont — xem lại trước khi lưu." : "Không thấy số cont trong ảnh, nhập tay hoặc chụp lại.",
        });
      } else {
        const sn = ocr.sealNumber ?? null;
        if (sn) {
          setRows((prev) =>
            prev.map((r) => {
              if (r._key !== target.rowKey) return r;
              const seals = [...r.seals];
              const sealNumber = sn.toUpperCase();
              const seal = seals[sealIndex] ?? emptySeal();
              seals[sealIndex] = { ...seal, sealNumber };
              return {
                ...r,
                seals,
                sealNumber: seals[0]?.sealNumber ?? "",
              };
            }),
          );
        }
        toast({
          kind: sn ? "info" : "error",
          message: sn ? "Đã nhận diện số seal — xem lại trước khi lưu." : "Không thấy số seal trong ảnh, nhập tay hoặc chụp lại.",
        });
      }
      if (ocr.error) toast({ kind: "info", message: ocr.error });
      void pending;
    } catch {
      toast({ kind: "error", message: "Lỗi tải ảnh lên — thử lại." });
    } finally {
      setUploading((prev) => ({
        ...prev,
        [target.rowKey]: { ...(prev[target.rowKey] ?? { cont: false, seal: false }), [field]: false },
      }));
    }
  };

  const removePhotoFromRow = async (row: ContainerRow, type: "CONTAINER" | "SEAL", url: string) => {
    const field = type === "CONTAINER" ? "cont" : "seal";
    const dropFromState = () => setRows((prev) => prev.map((r) => {
      if (r._key !== row._key) return r;
      if (type === "CONTAINER") {
        return { ...r, photoKeys: { ...r.photoKeys, cont: r.photoKeys.cont.filter((u) => u !== url) } };
      }
      const sealPhotos = r.photoKeys.seal.map((u) => (u === url ? "" : u));
      while (sealPhotos.length > 0 && !sealPhotos.at(-1)) sealPhotos.pop();
      return { ...r, photoKeys: { ...r.photoKeys, seal: sealPhotos } };
    }));

    if (url.startsWith("blob:")) {
      revokeContainerPhoto(row._key, type, url);
      dropFromState();
      return;
    }

    if (!tripId || !row.id) {
      toast({ kind: "error", message: "Ảnh đã lưu cần chuyến và cont đã lưu để xoá." });
      return;
    }

    setDeletingPhotos((prev) => ({
      ...prev,
      [row._key]: { ...(prev[row._key] ?? { cont: false, seal: false }), [field]: true },
    }));
    try {
      await deletePersistedPhoto(row, type, url);
      dropFromState();
      toast({ kind: "success", message: "Đã xoá ảnh." });
    } catch {
      toast({ kind: "error", message: "Không xoá được ảnh — thử lại." });
    } finally {
      setDeletingPhotos((prev) => ({
        ...prev,
        [row._key]: { ...(prev[row._key] ?? { cont: false, seal: false }), [field]: false },
      }));
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: 16, color: "var(--fg-3)", display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={16} className="spin" /> Đang tải container…
      </div>
    );
  }

  const hasAnyContainerPhoto = rows.some((r) => r.photoKeys.cont.some(Boolean) || r.photoKeys.seal.some(Boolean));
  const showRequiresWarning = !!requiresPhotos && !hasAnyContainerPhoto;

  const renderSealFields = (row: ContainerRow, index: 0 | 1) => {
    const seal = row.seals[index];
    const hasSealValue = !!(seal?.sealNumber.trim() || seal?.notes.trim());
    const sealNumberId = `seal-${row._key}-${index}`;
    const sealNotesId = `seal-notes-${row._key}-${index}`;
    return (
      <div className="ci-seal-fields">
        <div className="ci-field-group ci-field-group--seal-number">
          <label className="ci-label" htmlFor={sealNumberId}>Số seal {index + 1}</label>
          <input id={sealNumberId} className="input ci-input-sm" placeholder={`Số seal ${index + 1}`} value={seal?.sealNumber ?? ""} onChange={(e) => updateSeal(row._key, index, "sealNumber", e.target.value.toUpperCase())} />
        </div>
        <div className="ci-field-group ci-field-group--seal-notes">
          <label className="ci-label" htmlFor={sealNotesId}>Ghi chú</label>
          <input id={sealNotesId} className="input ci-input-sm" placeholder="Ghi chú seal (tuỳ chọn)" value={seal?.notes ?? ""} onChange={(e) => updateSeal(row._key, index, "notes", e.target.value)} />
        </div>
        <div className="ci-seal-fields__action">
          <button type="button" className="btn btn--ghost btn--icon btn--sm ci-clear-seal" style={{ visibility: hasSealValue ? "visible" : "hidden" }} onClick={() => clearSeal(row._key, index)} aria-label={`Xoá seal ${index + 1}`} title={`Xoá seal ${index + 1}`}>
            <X size={13} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="ci-editor">
      {showRequiresWarning && (
        <div className="ci-warning" role="note">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>Loại hàng này yêu cầu ảnh vỏ container và niêm phong (seal) để hoàn thành chuyến.</span>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="ci-empty">
          <ImageOff size={20} aria-hidden="true" />
          <div>
            <strong>Chưa có container</strong>
            <span>Thêm container để nhập số hiệu, seal và ảnh bằng chứng.</span>
          </div>
        </div>
      ) : (
        <div className="ci-records">
          {rows.map((row, idx) => (
            <section
              key={row._key}
              className="ci-record"
              aria-labelledby={`container-heading-${row._key}`}
            >
              <header className="ci-record__header">
                <div>
                  <span className="ci-record__eyebrow">Hồ sơ container</span>
                  <h3 id={`container-heading-${row._key}`}>Container {String(idx + 1).padStart(2, "0")}</h3>
                </div>
                <button type="button" className="btn btn--ghost btn--icon btn--sm ci-remove-record" onClick={() => removeRow(row._key)} aria-label={`Xoá container ${idx + 1}`} title={`Xoá container ${idx + 1}`}>
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </header>

              <div className="ci-record__body">
                <div className="ci-detail-row ci-detail-row--container">
                  <div className="ci-identity-fields">
                    <div className="ci-field-group ci-field-group--container-number">
                      <label className="ci-label" htmlFor={`containerNumber-${row._key}`}>
                        Số container <span>(tuỳ chọn)</span>
                      </label>
                      <input id={`containerNumber-${row._key}`} className="input ci-input-sm" placeholder="Ví dụ: TCKU1234567" value={row.containerNumber} onChange={(e) => updateRow(row._key, "containerNumber", e.target.value.toUpperCase())} />
                      {(() => {
                        const st = checkContainerNumber(row.containerNumber);
                        if (!st.warning) return null;
                        return (
                          <div className="ci-field-warning">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <span>{st.warning}</span>
                            {st.suggestion && (
                              <button type="button" className="ci-field-warning__action" onClick={() => updateRow(row._key, "containerNumber", st.suggestion!)}>
                                Đổi thành {st.suggestion}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="ci-field-group">
                      <label className="ci-label" htmlFor={`containerWeight-${row._key}`}>Trọng lượng (kg)</label>
                      <input id={`containerWeight-${row._key}`} type="number" className="input ci-input-sm" placeholder="Ví dụ: 24500" value={row.cargoWeightKg} onChange={(e) => updateRow(row._key, "cargoWeightKg", e.target.value)} min={0} max={99999999.99} />
                    </div>
                    <div className="ci-field-group">
                      <label className="ci-label" htmlFor={`containerNotes-${row._key}`}>Ghi chú container</label>
                      <input id={`containerNotes-${row._key}`} className="input ci-input-sm" placeholder="Ghi chú (tuỳ chọn)" value={row.notes} onChange={(e) => updateRow(row._key, "notes", e.target.value)} />
                    </div>
                  </div>
                  {renderPhotoLane(row, "CONTAINER")}
                </div>

                <div className="ci-detail-row ci-detail-row--seal">
                  {renderSealFields(row, 0)}
                  {renderPhotoLane(row, "SEAL", 0)}
                </div>

                <div className="ci-detail-row ci-detail-row--seal">
                  {renderSealFields(row, 1)}
                  {renderPhotoLane(row, "SEAL", 1)}
                </div>

              </div>
            </section>
          ))}
        </div>
      )}

      <div className="ci-editor__footer">
        <button type="button" className="btn btn--secondary btn--sm" onClick={addRow}>
          <Plus size={16} aria-hidden="true" /> Thêm container
        </button>
        <span>Dữ liệu container được gửi cùng nút hành động ở cuối biểu mẫu — “Tạo lệnh” khi tạo mới, “Lưu cập nhật” khi chỉnh sửa.</span>
      </div>

      {scanner && <ContainerScanner onCapture={handleCapture} onClose={() => setScanner(null)} />}
      {lightbox && <PhotoViewer urls={lightbox.urls} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}
