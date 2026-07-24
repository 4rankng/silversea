import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Camera, ImageOff, X } from "lucide-react";
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
    const allUrls = row.photoKeys[field].filter(Boolean);
    const urls = pType === "SEAL" && sealIndex != null ? allUrls.slice(sealIndex, sealIndex + 1) : allUrls.slice(-1);
    const busy = (uploading[row._key]?.[field] ?? false) || (deletingPhotos[row._key]?.[field] ?? false);
    const isCont = pType === "CONTAINER";
    return (
      <div className="ci-photo-lane">
        <div className="ci-photo-lane__head">
          <span className="ci-photo-lane__title">{title}</span>
          <button type="button" className="ci-photo-lane__capture" disabled={busy} onClick={() => setScanner({ rowKey: row._key, type: pType, sealIndex })} aria-label={isCont ? "Chụp ảnh container" : "Chụp ảnh seal"} title={isCont ? "Chụp ảnh container" : "Chụp ảnh seal"}>
            {busy ? <Loader2 size={13} className="spin" /> : <Camera size={13} />}
            <span>{urls.length > 0 ? "Đổi ảnh" : isCont ? "Chụp cont" : `Chụp seal ${(sealIndex ?? 0) + 1}`}</span>
          </button>
        </div>
        <div className="ci-photo-lane__drop" aria-busy={busy}>
          {urls.length === 0 ? (
            <button type="button" className="ci-photo-empty" disabled={busy} onClick={() => setScanner({ rowKey: row._key, type: pType, sealIndex })} aria-label={isCont ? "Chụp ảnh container" : "Chụp ảnh seal"}>
              <ImageOff size={16} />
              <span>Chưa có ảnh</span>
            </button>
          ) : (
            <>
              {urls.map((u, uIdx) => {
                const isPending = u.startsWith("blob:");
                return (
                  <span key={`${u}-${uIdx}`} className="ci-photo-slot">
                    <button
                      type="button"
                      className="ci-photo-slot__view"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        setLightbox({
                          rowKey: row._key,
                          type: pType,
                          urls: urls.map(photoSrc),
                          index: 0,
                        });
                      }}
                      aria-label={`Mở ảnh ${field} ${uIdx + 1}`}
                    >
                      <img src={photoSrc(u)} alt={`Ảnh ${field} ${uIdx + 1}`} />
                    </button>
                    <button
                      type="button"
                      className="ci-photo-slot__remove"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        void removePhotoFromRow(row, pType, u);
                      }}
                      aria-label={isCont ? "Xoá ảnh container" : "Xoá ảnh seal"}
                      title={isCont ? "Xoá ảnh container" : "Xoá ảnh seal"}
                    >
                      {deletingPhotos[row._key]?.[field] ? <Loader2 size={11} className="spin" /> : <X size={11} />}
                    </button>
                    {isPending && (
                      <span className="ci-photo-slot__pending" title="Chưa lưu — sẽ tải lên khi bấm Lưu cập nhật">
                        chưa lưu
                      </span>
                    )}
                  </span>
                );
              })}
            </>
          )}
        </div>
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
    const previousUrls = target.type === "SEAL" ? row.photoKeys.seal.filter(Boolean).slice(sealIndex, sealIndex + 1) : row.photoKeys.cont.filter(Boolean).slice(-1);
    setScanner(null);
    setUploading((prev) => ({
      ...prev,
      [target.rowKey]: { ...(prev[target.rowKey] ?? { cont: false, seal: false }), [field]: true },
    }));
    try {
      const file = dataUrlToFile(dataUrl);
      const { url, ocrResult: ocr, pending } = await uploadContainerPhoto(file, tripId, target.rowKey, target.type, row.id);
      for (const oldUrl of previousUrls) {
        if (oldUrl.startsWith("blob:")) revokeContainerPhoto(row._key, target.type, oldUrl);
      }
      setRows((prev) =>
        prev.map((r) => {
          if (r._key !== target.rowKey) return r;
          if (target.type === "SEAL") {
            const sealPhotos = r.photoKeys.seal.filter(Boolean);
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
    const dropFromState = () => setRows((prev) => prev.map((r) => (r._key === row._key ? { ...r, photoKeys: { ...r.photoKeys, [field]: r.photoKeys[field].filter((u) => u !== url) } } : r)));

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

  const hasAnyContainerPhoto = rows.some((r) => r.photoKeys.cont.length > 0 || r.photoKeys.seal.length > 0);
  const showRequiresWarning = !!requiresPhotos && !hasAnyContainerPhoto;

  const renderSealFields = (row: ContainerRow, index: 0 | 1) => {
    const seal = row.seals[index];
    const hasSealValue = !!(seal?.sealNumber.trim() || seal?.notes.trim());
    return (
      <div className="ci-seal-section">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-2)" }}>Số seal {index + 1}</span>
        </div>
        <div className="ci-seal-row">
          <input className="input ci-input-sm" style={{ width: 180 }} placeholder={`Số seal ${index + 1}`} value={seal?.sealNumber ?? ""} onChange={(e) => updateSeal(row._key, index, "sealNumber", e.target.value.toUpperCase())} />
          <input className="input ci-input-sm" style={{ width: 180, flex: 1, minWidth: 120 }} placeholder="Ghi chú seal (tuỳ chọn)" value={seal?.notes ?? ""} onChange={(e) => updateSeal(row._key, index, "notes", e.target.value)} />
          <button type="button" className="btn btn--ghost btn--icon btn--sm" style={{ minWidth: 40, visibility: hasSealValue ? "visible" : "hidden" }} onClick={() => clearSeal(row._key, index)} aria-label={`Xoá seal ${index + 1}`} title={`Xoá seal ${index + 1}`}>
            <X size={13} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div>
      {showRequiresWarning && (
        <div
          style={{
            padding: "10px 14px",
            background: "var(--warning-soft, #fff7e6)",
            color: "var(--warning-text, #b7791f)",
            border: "1px solid rgba(217, 119, 6, 0.18)",
            borderRadius: "var(--radius-md, 10px)",
            fontSize: 13,
            marginBottom: 12,
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          ⚠️ Loại hàng này yêu cầu đính kèm ảnh vỏ Container và Niêm phong (Seal) để hoàn thành chuyến đi.
        </div>
      )}
      {rows.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", color: "var(--fg-3)", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <img src="/assets/illustrations/empty-matching.svg" alt="Empty" style={{ width: 120, height: 120, opacity: 0.8, marginBottom: 16 }} />
          <p style={{ margin: 0, fontWeight: 500 }}>Chưa có cont nào. Bấm "Thêm cont" để bắt đầu.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((row, idx) => (
            <div
              key={row._key}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 12,
                padding: 12,
                background: "var(--bg-2, #fafafa)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-2)" }}>Cont #{idx + 1}</div>
                <button type="button" className="btn btn--ghost btn--icon btn--sm" style={{ width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => removeRow(row._key)} aria-label="Xoá dòng" title="Xoá cont">
                  <Trash2 size={15} style={{ color: "var(--danger)" }} />
                </button>
              </div>

              <div className="ci-row ci-row--identity">
                <label className="ci-label">
                  Số container <span style={{ color: "var(--fg-3)", fontWeight: 500 }}>(tuỳ chọn)</span>
                </label>
                <input id={`containerNumber-${row._key}`} className="input ci-input-sm" style={{ width: "100%" }} placeholder="VD: TCKU1234567" value={row.containerNumber} onChange={(e) => updateRow(row._key, "containerNumber", e.target.value.toUpperCase())} />
                {(() => {
                  const st = checkContainerNumber(row.containerNumber);
                  if (!st.warning) return null;
                  return (
                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 4,
                        alignItems: "center",
                        padding: "4px 6px",
                        background: "var(--warn-soft, #fff7e6)",
                        color: "var(--warn, #b7791f)",
                        borderRadius: 6,
                        fontSize: 13,
                      }}
                    >
                      <span>⚠ {st.warning}</span>
                      {st.suggestion && (
                        <button type="button" className="btn btn--ghost btn--sm" style={{ padding: "0 10px", fontSize: 12 }} onClick={() => updateRow(row._key, "containerNumber", st.suggestion!)}>
                          Đổi thành {st.suggestion}
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="ci-evidence-stack">
                {renderPhotoLane(row, "CONTAINER")}

                {renderSealFields(row, 0)}
                {renderPhotoLane(row, "SEAL", 0)}

                {renderSealFields(row, 1)}
                {renderPhotoLane(row, "SEAL", 1)}

                <div className="ci-row ci-row--meta">
                  <div>
                    <label className="ci-label">Trọng lượng (kg)</label>
                    <input type="number" className="input ci-input-sm" style={{ width: "100%" }} placeholder="VD: 24500" value={row.cargoWeightKg} onChange={(e) => updateRow(row._key, "cargoWeightKg", e.target.value)} min={0} max={99999999.99} />
                  </div>
                  <div>
                    <label className="ci-label">Ghi chú</label>
                    <input className="input ci-input-sm" style={{ width: "100%" }} placeholder="Ghi chú cont (tuỳ chọn)" value={row.notes} onChange={(e) => updateRow(row._key, "notes", e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={addRow}>
          <Plus size={14} /> Thêm cont
        </button>
        <span style={{ fontSize: 13, color: "var(--fg-3)" }}>Container lưu cùng nút "Lưu cập nhật" ở dưới.</span>
      </div>

      {scanner && <ContainerScanner onCapture={handleCapture} onClose={() => setScanner(null)} />}
      {lightbox && <PhotoViewer urls={lightbox.urls} initialIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}
