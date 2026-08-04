import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Search, Send, Truck } from 'lucide-react';
import { EmptyState, SearchableSelect, SelectField, TextField } from '../design-system';
import {
  getDispatchFleet,
  createCarrierFleetVehicle,
  issueDispatchOrder,
  listDispatchFleetResources,
  listDispatchHandoffs,
  listDispatchQueue,
  listCarrierFleetVehicles,
  resolveDispatchHandoff,
  updateCarrierFleetVehicle,
  type DispatchDriver,
  type DispatchCarrierVehicle,
  type DispatchFleet,
  type DispatchHandoffItem,
  type DispatchQueueItem,
  type DispatchTruck,
} from '../api/dispatchPlanningClient';
import { useAuth } from '../hooks/useAuth';
import { Role } from '@tingting/shared';
import { formatVietnamDateTimeInput, localDateTimeToIso } from '../lib/shipment-operations';
import './DispatchPage.css';

type MobilePane = 'TASKS' | 'FLEET' | 'DETAIL';

interface AssignmentForm {
  carrierType: 'OWN' | 'EXTERNAL';
  truckId: string;
  driverId: string;
  trailerId: string;
  pricingRateKey: string;
  externalCarrierId: string;
  externalVehicleId: string;
  externalPlateNumber: string;
  externalDriverName: string;
  externalDriverPhone: string;
  plannedStartAt: string;
  plannedEndAt: string;
  endTimeConfirmed: boolean;
}

interface TaskCursorState {
  handoffCursor: string | null;
  queueCursor: string | null;
}

interface ResourceSearchState<T> {
  query: string;
  items: T[];
  nextCursor: string | null;
  loadingMore: boolean;
}

const TASK_PAGE_LIMIT = 50;
const FLEET_PAGE_LIMIT = 100;
const INITIAL_TASK_CURSOR: TaskCursorState = { handoffCursor: null, queueCursor: null };

function emptyResourceSearch<T>(): ResourceSearchState<T> {
  return { query: '', items: [], nextCursor: null, loadingMore: false };
}

const EMPTY_ASSIGNMENT: AssignmentForm = {
  carrierType: 'OWN',
  truckId: '',
  driverId: '',
  trailerId: '',
  pricingRateKey: '',
  externalCarrierId: '',
  externalVehicleId: '',
  externalPlateNumber: '',
  externalDriverName: '',
  externalDriverPhone: '',
  plannedStartAt: '',
  plannedEndAt: '',
  endTimeConfirmed: false,
};

function formatDateTime(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function DetailLine({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="dispatch-detail-line"><span>{label}</span><strong>{value || '—'}</strong></div>;
}

function computePlannedEndAt(plannedStartAt: string, serviceDurationMinutes: number | null | undefined): string {
  if (!plannedStartAt || serviceDurationMinutes == null) return '';
  try {
    const plannedStartIso = localDateTimeToIso(plannedStartAt);
    if (!plannedStartIso) return '';
    return formatVietnamDateTimeInput(new Date(new Date(plannedStartIso).getTime() + serviceDurationMinutes * 60_000));
  } catch {
    return '';
  }
}

function suggestedPricingRateKey(item: DispatchQueueItem): string {
  if (item.cargoMode !== 'FCL') return '';
  const label = item.unitSummary.containerTypeLabel?.toUpperCase() ?? '';
  if (label.startsWith('20')) return 'CONT20';
  if (label.startsWith('40')) return 'CONT40';
  return '';
}

const PRICING_RATE_KEYS = ['CONT20', 'CONT40', '1.25T', '2.5T', '3.5T', '5T', '8T', '10T', '15T'];

function normalizeFleet(resources: DispatchFleet | null): DispatchFleet | null {
  if (!resources) return null;
  const loadedDrivers = resources.drivers.items;
  return {
    ...resources,
    trucks: {
      ...resources.trucks,
      items: resources.trucks.items.map((truck) => {
        const assigned = loadedDrivers.find((driver) => driver.assignedTruckId === truck.id);
        return {
          ...truck,
          assignedDriverId: truck.assignedDriverId ?? assigned?.id ?? null,
          assignedDriverName: truck.assignedDriverName ?? assigned?.name ?? null,
        };
      }),
    },
  };
}

function mergeById<T extends { id: number }>(...groups: Array<ReadonlyArray<T>>): T[] {
  return [...new Map(groups.flat().map((item) => [item.id, item])).values()];
}

function isFleetAccessDenied(reason: unknown) {
  const message = reason instanceof Error ? reason.message : '';
  return /không được xem đội xe điều phối|không có quyền xem bảng điều phối|403/i.test(message);
}

function resolvePlannedCarrier(item: DispatchQueueItem | null) {
  if (!item) return null;
  if (item.plannedCarrier) return item.plannedCarrier;
  if (item.dispatch?.carrierType === 'EXTERNAL') {
    return {
      carrierType: 'EXTERNAL' as const,
      externalCarrierId: item.dispatch.externalCarrierId ?? null,
      carrierName: item.dispatch.externalCarrierName ?? null,
      vehiclePlate: item.dispatch.externalPlateNumber ?? null,
    };
  }
  if (item.dispatch?.carrierType === 'OWN') {
    return {
      carrierType: 'OWN' as const,
      externalCarrierId: null,
      carrierName: 'Đội xe nội bộ SilverSea',
    };
  }
  return null;
}

export default function DispatchPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<DispatchQueueItem[]>([]);
  const [fleet, setFleet] = useState<DispatchFleet | null>(null);
  const [handoffs, setHandoffs] = useState<DispatchHandoffItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [urgency, setUrgency] = useState<'' | 'NORMAL' | 'URGENT'>('');
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>('TASKS');
  const [assignment, setAssignment] = useState<AssignmentForm>(EMPTY_ASSIGNMENT);
  const [fleetAccessDenied, setFleetAccessDenied] = useState(false);
  const [taskTotals, setTaskTotals] = useState({ handoffs: 0, queue: 0, ready: 0, dispatched: 0 });
  const [taskCursorStack, setTaskCursorStack] = useState<TaskCursorState[]>([INITIAL_TASK_CURSOR]);
  const [taskPageIndex, setTaskPageIndex] = useState(0);
  const [nextTaskCursor, setNextTaskCursor] = useState<TaskCursorState | null>(null);
  const [truckSearch, setTruckSearch] = useState<ResourceSearchState<DispatchTruck>>(emptyResourceSearch);
  const [driverSearch, setDriverSearch] = useState<ResourceSearchState<DispatchDriver>>(emptyResourceSearch);
  const [externalVehicleSearch, setExternalVehicleSearch] = useState<ResourceSearchState<DispatchCarrierVehicle>>(emptyResourceSearch);
  const [externalVehicleLoading, setExternalVehicleLoading] = useState(false);
  const [managedCarrierId, setManagedCarrierId] = useState('');
  const [managedPlate, setManagedPlate] = useState('');
  const [managedVehicles, setManagedVehicles] = useState<DispatchCarrierVehicle[]>([]);
  const [managingVehicle, setManagingVehicle] = useState(false);
  const loadRequestIdRef = useRef(0);
  const resourceSearchRequestIds = useRef({ TRUCK: 0, DRIVER: 0, EXTERNAL_VEHICLE: 0 });

  const currentTaskCursor = taskCursorStack[taskPageIndex] ?? INITIAL_TASK_CURSOR;
  const selected = useMemo(() => items.find((item) => item.fulfillmentId === selectedId) ?? null, [items, selectedId]);
  const plannedCarrier = useMemo(() => resolvePlannedCarrier(selected), [selected]);
  const effectiveCarrier = useMemo(() => {
    if (plannedCarrier) return plannedCarrier;
    if (selected?.cargoMode !== 'LCL') return null;
    const selectedLclCarrier = fleet?.externalCarriers.items.find((carrier) => String(carrier.id) === assignment.externalCarrierId);
    return {
      carrierType: assignment.carrierType,
      externalCarrierId: assignment.carrierType === 'EXTERNAL' && assignment.externalCarrierId
        ? Number(assignment.externalCarrierId)
        : null,
      carrierName: assignment.carrierType === 'OWN'
        ? 'Đội xe nội bộ SilverSea'
        : selectedLclCarrier?.name ?? null,
    };
  }, [assignment.carrierType, assignment.externalCarrierId, fleet?.externalCarriers.items, plannedCarrier, selected?.cargoMode]);
  const taskCountLoaded = handoffs.length + items.length;
  const selectedTruck = selected?.dispatch?.truckId && selected.dispatch.truckPlate
    ? {
      id: selected.dispatch.truckId,
      licensePlate: selected.dispatch.truckPlate,
      status: 'ACTIVE',
      trailerType: null,
      currentTrailerId: selected.dispatch.trailerId,
      currentTrailerPlate: selected.dispatch.trailerPlate,
      capacityKg: null,
      assignedDriverId: selected.dispatch.driverId,
      assignedDriverName: selected.dispatch.driverName,
    } satisfies DispatchTruck
    : null;
  const selectedDriver = selected?.dispatch?.driverId && selected.dispatch.driverName
    ? {
      id: selected.dispatch.driverId,
      name: selected.dispatch.driverName,
      phone: null,
      status: 'ACTIVE',
      assignedTruckId: selected.dispatch.truckId,
      assignedTruckPlate: selected.dispatch.truckPlate,
      userId: selected.dispatch.driverId,
    } satisfies DispatchDriver
    : null;
  const selectedExternalVehicle = selected?.dispatch?.externalPlateNumber
    ? {
      id: -selected.fulfillmentId,
      carrierId: effectiveCarrier?.externalCarrierId ?? selected.dispatch?.externalCarrierId ?? 0,
      licensePlate: selected.dispatch.externalPlateNumber,
      isActive: true,
    } satisfies DispatchCarrierVehicle
    : null;
  const truckChoices = mergeById(fleet?.trucks.items ?? [], truckSearch.items, selectedTruck ? [selectedTruck] : []);
  const driverChoices = mergeById(fleet?.drivers.items ?? [], driverSearch.items, selectedDriver ? [selectedDriver] : []);
  const externalVehicleChoices = mergeById(externalVehicleSearch.items, selectedExternalVehicle ? [selectedExternalVehicle] : []);
  const activeTrucks = truckChoices.filter((truck) => truck.status === 'ACTIVE');
  const eligibleDrivers = driverChoices.filter((driver) => driver.status === 'ACTIVE' && driver.userId != null);
  const activeExternalVehicles = externalVehicleChoices.filter((vehicle) => vehicle.isActive);
  const canManageCarrierVehicles = user?.role === Role.ADMIN || user?.role === Role.MANAGER;

  const refreshManagedVehicles = useCallback(async (carrierId: string) => {
    if (!carrierId) {
      setManagedVehicles([]);
      return;
    }
    const response = await listCarrierFleetVehicles(Number(carrierId));
    setManagedVehicles(response.items);
  }, []);

  async function addManagedVehicle() {
    if (!managedCarrierId || !managedPlate.trim()) return;
    setManagingVehicle(true);
    setError(null);
    try {
      await createCarrierFleetVehicle({ carrierId: Number(managedCarrierId), licensePlate: managedPlate.trim() });
      setManagedPlate('');
      await refreshManagedVehicles(managedCarrierId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể thêm xe nhà xe.');
    } finally {
      setManagingVehicle(false);
    }
  }

  async function toggleManagedVehicle(vehicle: DispatchCarrierVehicle) {
    setManagingVehicle(true);
    setError(null);
    try {
      await updateCarrierFleetVehicle(vehicle.id, { isActive: !vehicle.isActive });
      await refreshManagedVehicles(managedCarrierId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể cập nhật xe nhà xe.');
    } finally {
      setManagingVehicle(false);
    }
  }
  const load = useCallback(async (cursorState: TaskCursorState) => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const inbox = await listDispatchHandoffs({
        cursor: cursorState.handoffCursor,
        limit: TASK_PAGE_LIMIT,
        q: searchQuery || undefined,
        urgency,
      });
      const remainingQueueSlots = Math.max(0, TASK_PAGE_LIMIT - inbox.items.length);
      const queue = await listDispatchQueue({
        cursor: cursorState.queueCursor,
        limit: Math.max(remainingQueueSlots, 1),
        status: ['READY', 'DISPATCHED'],
        q: searchQuery || undefined,
        urgency,
      });
      const resources = await getDispatchFleet({ limit: FLEET_PAGE_LIMIT }).catch((reason) => {
        if (isFleetAccessDenied(reason)) return null;
        throw reason;
      });
      if (requestId !== loadRequestIdRef.current) return;

      const queueItems = remainingQueueSlots > 0 ? queue.items.slice(0, remainingQueueSlots) : [];
      const normalizedFleet = normalizeFleet(resources);
      setHandoffs(inbox.items);
      setItems(queueItems);
      setFleet(normalizedFleet);
      setFleetAccessDenied(resources == null);
      setTaskTotals({
        handoffs: inbox.total,
        queue: queue.total,
        ready: queue.readyCount,
        dispatched: queue.dispatchedCount,
      });
      const nextCursor = inbox.nextCursor
        ? { handoffCursor: inbox.nextCursor, queueCursor: cursorState.queueCursor }
        : queue.nextCursor
          ? { handoffCursor: null, queueCursor: queue.nextCursor }
          : null;
      setNextTaskCursor(nextCursor);
      setSelectedId((current) => current && queueItems.some((item) => item.fulfillmentId === current)
        ? current
        : queueItems[0]?.fulfillmentId ?? null);
    } catch (reason) {
      if (requestId !== loadRequestIdRef.current) return;
      setError(reason instanceof Error ? reason.message : 'Không thể tải bảng điều phối');
    } finally {
      if (requestId === loadRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [searchQuery, urgency]);

  useEffect(() => {
    setTaskCursorStack([INITIAL_TASK_CURSOR]);
    setTaskPageIndex(0);
    setNextTaskCursor(null);
  }, [searchQuery, urgency]);

  useEffect(() => {
    void load(currentTaskCursor);
  }, [currentTaskCursor, load]);

  useEffect(() => {
    if (!selected) {
      setAssignment(EMPTY_ASSIGNMENT);
      return;
    }
    setAssignment({
      ...EMPTY_ASSIGNMENT,
      carrierType: plannedCarrier?.carrierType ?? selected.dispatch?.carrierType ?? 'OWN',
      truckId: selected.dispatch?.truckId ? String(selected.dispatch.truckId) : '',
      driverId: selected.dispatch?.driverId ? String(selected.dispatch.driverId) : '',
      trailerId: selected.dispatch?.trailerId ? String(selected.dispatch.trailerId) : '',
      pricingRateKey: suggestedPricingRateKey(selected),
      externalCarrierId: plannedCarrier?.externalCarrierId ? String(plannedCarrier.externalCarrierId) : '',
      externalVehicleId: selected.dispatch?.externalPlateNumber ? String(-selected.fulfillmentId) : '',
      externalPlateNumber: selected.dispatch?.externalPlateNumber ?? '',
      externalDriverName: selected.dispatch?.externalDriverName ?? '',
      externalDriverPhone: selected.dispatch?.externalDriverPhone ?? '',
      plannedStartAt: formatVietnamDateTimeInput(selected.dispatch?.plannedStartAt ?? null),
      plannedEndAt: formatVietnamDateTimeInput(selected.dispatch?.plannedEndAt ?? null),
      endTimeConfirmed: selected.route.serviceDurationMinutes == null && Boolean(selected.dispatch?.plannedEndAt),
    });
  }, [plannedCarrier, selected]);

  useEffect(() => {
    if (!selected || selected.route.serviceDurationMinutes == null || !assignment.plannedStartAt) return;
    const computedEndAt = computePlannedEndAt(assignment.plannedStartAt, selected.route.serviceDurationMinutes);
    if (!computedEndAt) return;
    setAssignment((current) => current.plannedEndAt === computedEndAt && current.endTimeConfirmed === false
      ? current
      : { ...current, plannedEndAt: computedEndAt, endTimeConfirmed: false });
  }, [assignment.plannedStartAt, selected]);

  function update<K extends keyof AssignmentForm>(key: K, value: AssignmentForm[K]) {
    setAssignment((current) => ({ ...current, [key]: value }));
    setError(null);
    setSuccess(null);
  }

  const searchTrucks = useCallback(async (q: string) => {
    const requestId = ++resourceSearchRequestIds.current.TRUCK;
    if (!q) {
      setTruckSearch(emptyResourceSearch());
      return;
    }
    try {
      const result = await listDispatchFleetResources('TRUCK', { q, limit: 25 });
      if (requestId !== resourceSearchRequestIds.current.TRUCK) return;
      setTruckSearch({ query: q, items: result.items, nextCursor: result.nextCursor, loadingMore: false });
    } catch (reason) {
      if (requestId !== resourceSearchRequestIds.current.TRUCK) return;
      setTruckSearch(emptyResourceSearch());
      setError(reason instanceof Error ? reason.message : 'Không thể tìm tài nguyên điều phối');
    }
  }, []);

  const searchDrivers = useCallback(async (q: string) => {
    const requestId = ++resourceSearchRequestIds.current.DRIVER;
    if (!q) {
      setDriverSearch(emptyResourceSearch());
      return;
    }
    try {
      const result = await listDispatchFleetResources('DRIVER', { q, limit: 25 });
      if (requestId !== resourceSearchRequestIds.current.DRIVER) return;
      setDriverSearch({ query: q, items: result.items, nextCursor: result.nextCursor, loadingMore: false });
    } catch (reason) {
      if (requestId !== resourceSearchRequestIds.current.DRIVER) return;
      setDriverSearch(emptyResourceSearch());
      setError(reason instanceof Error ? reason.message : 'Không thể tìm tài nguyên điều phối');
    }
  }, []);

  const searchExternalVehicles = useCallback(async (q: string) => {
    const carrierId = effectiveCarrier?.carrierType === 'EXTERNAL' ? effectiveCarrier.externalCarrierId : null;
    const requestId = ++resourceSearchRequestIds.current.EXTERNAL_VEHICLE;
    if (!carrierId) {
      setExternalVehicleSearch(emptyResourceSearch());
      return;
    }
    if (!q) {
      setExternalVehicleLoading(true);
      try {
        const result = await listDispatchFleetResources('EXTERNAL_VEHICLE', { carrierId, limit: 25 });
        if (requestId !== resourceSearchRequestIds.current.EXTERNAL_VEHICLE) return;
        setExternalVehicleSearch({ query: '', items: result.items, nextCursor: result.nextCursor, loadingMore: false });
      } catch (reason) {
        if (requestId !== resourceSearchRequestIds.current.EXTERNAL_VEHICLE) return;
        setExternalVehicleSearch(emptyResourceSearch());
        setError(reason instanceof Error ? reason.message : 'Không thể tải xe của nhà xe đã gán');
      } finally {
        if (requestId === resourceSearchRequestIds.current.EXTERNAL_VEHICLE) {
          setExternalVehicleLoading(false);
        }
      }
      return;
    }
    setExternalVehicleLoading(true);
    try {
      const result = await listDispatchFleetResources('EXTERNAL_VEHICLE', { carrierId, q, limit: 25 });
      if (requestId !== resourceSearchRequestIds.current.EXTERNAL_VEHICLE) return;
      setExternalVehicleSearch({ query: q, items: result.items, nextCursor: result.nextCursor, loadingMore: false });
    } catch (reason) {
      if (requestId !== resourceSearchRequestIds.current.EXTERNAL_VEHICLE) return;
      setExternalVehicleSearch(emptyResourceSearch());
      setError(reason instanceof Error ? reason.message : 'Không thể tìm xe của nhà xe đã gán');
    } finally {
      if (requestId === resourceSearchRequestIds.current.EXTERNAL_VEHICLE) {
        setExternalVehicleLoading(false);
      }
    }
  }, [effectiveCarrier]);

  const loadMoreTrucks = useCallback(async () => {
    const searchPage = truckSearch.query !== '';
    const cursor = searchPage ? truckSearch.nextCursor : fleet?.trucks.nextCursor;
    if (!cursor) return;
    const requestId = ++resourceSearchRequestIds.current.TRUCK;
    setTruckSearch((current) => ({ ...current, loadingMore: true }));
    try {
      const result = await listDispatchFleetResources('TRUCK', {
        cursor,
        limit: searchPage ? 25 : FLEET_PAGE_LIMIT,
        q: searchPage ? truckSearch.query : undefined,
      });
      if (requestId !== resourceSearchRequestIds.current.TRUCK) return;
      if (searchPage) {
        setTruckSearch((current) => ({ ...current, items: mergeById(current.items, result.items), nextCursor: result.nextCursor, loadingMore: false }));
      } else {
        setFleet((current) => current ? { ...current, trucks: { ...result, items: mergeById(current.trucks.items, result.items) } } : current);
        setTruckSearch((current) => ({ ...current, loadingMore: false }));
      }
    } catch (reason) {
      if (requestId !== resourceSearchRequestIds.current.TRUCK) return;
      setTruckSearch((current) => ({ ...current, loadingMore: false }));
      setError(reason instanceof Error ? reason.message : 'Không thể tải thêm xe');
    }
  }, [fleet?.trucks.nextCursor, truckSearch]);

  const loadMoreDrivers = useCallback(async () => {
    const searchPage = driverSearch.query !== '';
    const cursor = searchPage ? driverSearch.nextCursor : fleet?.drivers.nextCursor;
    if (!cursor) return;
    const requestId = ++resourceSearchRequestIds.current.DRIVER;
    setDriverSearch((current) => ({ ...current, loadingMore: true }));
    try {
      const result = await listDispatchFleetResources('DRIVER', {
        cursor,
        limit: searchPage ? 25 : FLEET_PAGE_LIMIT,
        q: searchPage ? driverSearch.query : undefined,
      });
      if (requestId !== resourceSearchRequestIds.current.DRIVER) return;
      if (searchPage) {
        setDriverSearch((current) => ({ ...current, items: mergeById(current.items, result.items), nextCursor: result.nextCursor, loadingMore: false }));
      } else {
        setFleet((current) => current ? { ...current, drivers: { ...result, items: mergeById(current.drivers.items, result.items) } } : current);
        setDriverSearch((current) => ({ ...current, loadingMore: false }));
      }
    } catch (reason) {
      if (requestId !== resourceSearchRequestIds.current.DRIVER) return;
      setDriverSearch((current) => ({ ...current, loadingMore: false }));
      setError(reason instanceof Error ? reason.message : 'Không thể tải thêm lái xe');
    }
  }, [driverSearch, fleet?.drivers.nextCursor]);

  const loadMoreExternalVehicles = useCallback(async () => {
    const carrierId = effectiveCarrier?.carrierType === 'EXTERNAL' ? effectiveCarrier.externalCarrierId : null;
    const searchPage = externalVehicleSearch.query !== '';
    const cursor = externalVehicleSearch.nextCursor;
    if (!carrierId || !cursor) return;
    const requestId = ++resourceSearchRequestIds.current.EXTERNAL_VEHICLE;
    setExternalVehicleSearch((current) => ({ ...current, loadingMore: true }));
    try {
      const result = await listDispatchFleetResources('EXTERNAL_VEHICLE', {
        carrierId,
        cursor,
        limit: 25,
        q: searchPage ? externalVehicleSearch.query : undefined,
      });
      if (requestId !== resourceSearchRequestIds.current.EXTERNAL_VEHICLE) return;
      setExternalVehicleSearch((current) => ({
        ...current,
        items: mergeById(current.items, result.items),
        nextCursor: result.nextCursor,
        loadingMore: false,
      }));
    } catch (reason) {
      if (requestId !== resourceSearchRequestIds.current.EXTERNAL_VEHICLE) return;
      setExternalVehicleSearch((current) => ({ ...current, loadingMore: false }));
      setError(reason instanceof Error ? reason.message : 'Không thể tải thêm xe của nhà xe đã gán');
    }
  }, [effectiveCarrier, externalVehicleSearch]);

  function rememberTruck(truck: DispatchTruck | undefined) {
    if (!truck) return;
    setFleet((current) => current ? {
      ...current,
      trucks: { ...current.trucks, items: mergeById(current.trucks.items, [truck]) },
    } : current);
  }

  function rememberDriver(driver: DispatchDriver | undefined) {
    if (!driver) return;
    setFleet((current) => current ? {
      ...current,
      drivers: { ...current.drivers, items: mergeById(current.drivers.items, [driver]) },
    } : current);
  }

  useEffect(() => {
    if (effectiveCarrier?.carrierType !== 'EXTERNAL' || !effectiveCarrier.externalCarrierId) {
      setExternalVehicleSearch(emptyResourceSearch());
      setExternalVehicleLoading(false);
      return;
    }
    void searchExternalVehicles('');
  }, [effectiveCarrier, searchExternalVehicles]);

  function goToNextTaskPage() {
    if (!nextTaskCursor) return;
    setTaskCursorStack((current) => {
      const nextStack = current.slice(0, taskPageIndex + 1);
      nextStack.push(nextTaskCursor);
      return nextStack;
    });
    setTaskPageIndex((current) => current + 1);
    setMobilePane('TASKS');
  }

  function goToPreviousTaskPage() {
    if (taskPageIndex === 0) return;
    setTaskPageIndex((current) => current - 1);
    setMobilePane('TASKS');
  }

  const plannedCarrierLabel = effectiveCarrier?.carrierName?.trim()
    || (effectiveCarrier?.carrierType === 'OWN' ? 'Đội xe nội bộ SilverSea' : null)
    || (selected?.cargoMode === 'LCL' ? 'Chọn nhà xe khi điều xe' : 'Chưa có nhà xe đã gán');
  const derivedEndAt = selected?.route.serviceDurationMinutes == null
    ? assignment.plannedEndAt
    : computePlannedEndAt(assignment.plannedStartAt, selected.route.serviceDurationMinutes);
  const issueBlockedReason = (() => {
    if (!selected) return 'Chọn một tác vụ để phát hành lệnh điều xe.';
    if (selected.accountingLock) {
      return `Kế toán đã khóa tác vụ này${selected.accountingLock.activatedByName ? ` (${selected.accountingLock.activatedByName})` : ''}: ${selected.accountingLock.reason}`;
    }
    if (!effectiveCarrier) return 'Tác vụ này chưa được gán nhà xe từ hồ sơ lô hàng.';
    if (!assignment.plannedStartAt || !derivedEndAt) return 'Nhập giờ bắt đầu và giờ kết thúc dự kiến trước khi phát hành.';
    if (selected.route.serviceDurationMinutes == null && !assignment.endTimeConfirmed) {
      return 'Tuyến chưa có thời lượng chuẩn; cần xác nhận giờ kết thúc đã nhập.';
    }
    if (effectiveCarrier.carrierType === 'OWN') {
      if (fleetAccessDenied) return 'Tài khoản hiện tại không có quyền xem đội xe nội bộ để phát hành lệnh.';
      if (!assignment.truckId || !assignment.driverId) return 'Chọn đủ xe và lái xe nội bộ trước khi phát hành.';
      return null;
    }
    if (!effectiveCarrier.externalCarrierId) return 'Chọn nhà xe đối tác trước khi phát hành.';
    if (selected.cargoMode === 'LCL') {
      if (!assignment.externalPlateNumber.trim()) return 'Nhập biển số xe của nhà xe trước khi phát hành.';
      if (!assignment.externalDriverName.trim()) return 'Nhập tên lái xe của nhà xe trước khi phát hành.';
      return null;
    }
    if (externalVehicleLoading) return 'Đang tải danh sách xe của nhà xe đã gán.';
    if (!assignment.externalVehicleId) {
      if (activeExternalVehicles.length === 0 && !externalVehicleSearch.nextCursor) {
        return `Nhà xe ${plannedCarrierLabel} chưa có xe khả dụng để chọn.`;
      }
      return 'Chọn xe của nhà xe đã gán trước khi phát hành.';
    }
    if (!assignment.externalDriverName.trim()) return 'Nhập tên lái xe của nhà xe trước khi phát hành.';
    return null;
  })();

  async function issue() {
    if (!selected) return;
    if (!effectiveCarrier) {
      setError('Tác vụ này chưa được gán nhà xe từ hồ sơ lô hàng.');
      return;
    }
    if (issueBlockedReason) {
      setError(issueBlockedReason);
      return;
    }

    setIssuing(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await issueDispatchOrder(selected, {
        plannedStartAt: localDateTimeToIso(assignment.plannedStartAt)!,
        plannedEndAt: localDateTimeToIso(derivedEndAt)!,
        endTimeConfirmed: selected.route.serviceDurationMinutes == null ? assignment.endTimeConfirmed : false,
        carrierType: effectiveCarrier.carrierType,
        truckId: effectiveCarrier.carrierType === 'OWN' ? Number(assignment.truckId) : null,
        driverId: effectiveCarrier.carrierType === 'OWN' ? Number(assignment.driverId) : null,
        trailerId: effectiveCarrier.carrierType === 'OWN' && assignment.trailerId ? Number(assignment.trailerId) : null,
        pricingRateKey: assignment.pricingRateKey || null,
        externalCarrierId: effectiveCarrier.carrierType === 'EXTERNAL' ? effectiveCarrier.externalCarrierId : null,
        externalCarrierVehicleId: effectiveCarrier.carrierType === 'EXTERNAL' && Number(assignment.externalVehicleId) > 0
          ? Number(assignment.externalVehicleId)
          : null,
        externalPlateNumber: effectiveCarrier.carrierType === 'EXTERNAL' ? assignment.externalPlateNumber : null,
        externalDriverName: effectiveCarrier.carrierType === 'EXTERNAL' ? assignment.externalDriverName.trim() : null,
        externalDriverPhone: effectiveCarrier.carrierType === 'EXTERNAL' ? assignment.externalDriverPhone.trim() || null : null,
      });
      setSuccess(`Đã phát hành lệnh ${result.trip.tripCode} và gửi thông báo trong ứng dụng.`);
      await load(currentTaskCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể phát hành lệnh điều xe');
    } finally {
      setIssuing(false);
    }
  }

  async function acceptHandoff(handoff: DispatchHandoffItem) {
    setError(null);
    setSuccess(null);
    try {
      await resolveDispatchHandoff(handoff, 'ACCEPTED');
      setSuccess(`Đã tiếp nhận ${handoff.shipment.code || handoff.shipment.bookingRef || 'lô hàng vừa chọn'} và tạo tác vụ điều phối.`);
      await load(currentTaskCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tiếp nhận lô hàng');
    }
  }

  return (
    <div className="dispatch-workbench">
      <header className="dispatch-workbench__header">
        <div>
          <div className="dispatch-workbench__eyebrow">Bảng kế hoạch</div>
          <h1>Điều phối chuyến xe</h1>
          <p>Mỗi container FCL là một tác vụ; mỗi lô LCL là một tác vụ.</p>
        </div>
        <button type="button" onClick={() => void load(currentTaskCursor)} disabled={loading} className="dispatch-icon-button">
          <RefreshCw size={18} /> Tải lại
        </button>
      </header>
      <div className="dispatch-toolbar">
        <label>
          <span>Tìm tác vụ</span>
          <div className="dispatch-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') setSearchQuery(query.trim()); }}
              placeholder="Khách hàng, booking, container…"
            />
          </div>
        </label>
        <SelectField label="Mức ưu tiên" value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)}>
          <option value="">Tất cả</option>
          <option value="URGENT">Gấp</option>
          <option value="NORMAL">Bình thường</option>
        </SelectField>
        <button type="button" onClick={() => setSearchQuery(query.trim())} className="dispatch-search-button">Tìm kiếm</button>
      </div>
      <div className="dispatch-mobile-tabs" role="tablist" aria-label="Khu vực điều phối">
        {([
          ['TASKS', `Tác vụ (${taskTotals.handoffs + taskTotals.queue})`],
          ['FLEET', fleetAccessDenied ? 'Đội xe (ẩn)' : `Đội xe (${fleet?.trucks.total ?? 0})`],
          ['DETAIL', 'Chi tiết'],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={mobilePane === value} onClick={() => setMobilePane(value)}>
            {label}
          </button>
        ))}
      </div>
      {error && <div role="alert" className="dispatch-message dispatch-message--error"><AlertTriangle size={18} />{error}</div>}
      {success && <div role="status" className="dispatch-message dispatch-message--success"><CheckCircle2 size={18} />{success}</div>}

      <div className="dispatch-workbench__grid">
        <section className={`dispatch-pane dispatch-pane--tasks ${mobilePane === 'TASKS' ? 'is-mobile-active' : ''}`} aria-label="Danh sách tác vụ">
          <div className="dispatch-pane__head">
            <strong>Tác vụ chờ điều phối</strong>
            <span>
              {taskTotals.handoffs + taskTotals.queue > TASK_PAGE_LIMIT
                ? `Hiển thị ${taskCountLoaded} / ${TASK_PAGE_LIMIT} mỗi trang · ${taskTotals.handoffs + taskTotals.queue} tổng`
                : `${taskTotals.handoffs + taskTotals.queue} tác vụ đang chờ`}
            </span>
          </div>
          <div className="dispatch-pane__scroll">
            {loading ? <div className="dispatch-loading">Đang tải…</div> : handoffs.length === 0 && items.length === 0 ? <EmptyState title="Không có tác vụ chờ điều phối" description="Các lô hợp lệ từ CUS sẽ xuất hiện tại đây." /> : <>
              {handoffs.map((handoff) => (
                <div key={`handoff-${handoff.handoffId}`} className="dispatch-handoff">
                  <div>
                    <span className="dispatch-urgent">Lô mới</span>
                    <strong>{handoff.shipment.code || handoff.shipment.bookingRef || 'Lô hàng chưa có mã'}</strong>
                    <small>
                      {handoff.customer.name} · {handoff.shipment.cargoMode === 'FCL' ? `${handoff.summary.containerNumbers.length} container` : handoff.summary.lclLabel}
                    </small>
                  </div>
                  <button type="button" onClick={() => void acceptHandoff(handoff)}>Tiếp nhận</button>
                </div>
              ))}
              {items.map((item) => (
                <button
                  key={item.fulfillmentId}
                  type="button"
                  className={`dispatch-task ${selectedId === item.fulfillmentId ? 'is-selected' : ''}`}
                  onClick={() => { setSelectedId(item.fulfillmentId); setMobilePane('DETAIL'); }}
                >
                  <div className="dispatch-task__top">
                    <strong>{item.unitSummary.label}</strong>
                    <span className={item.taskStatus === 'DISPATCHED' ? '' : 'dispatch-urgent'}>
                      {item.taskStatus === 'DISPATCHED' ? 'Đã phát hành' : item.urgency === 'URGENT' ? 'Gấp' : 'Sẵn sàng'}
                    </span>
                  </div>
                  <div>{item.customer.name}</div>
                  <small>{item.route.name}</small>
                  <div className="dispatch-task__dates">
                    <span>Cut-off: {formatDateTime(item.shipment.customsCutoffAt)}</span>
                    <span>Đóng: {formatDateTime(item.shipment.closingAt)}</span>
                  </div>
                </button>
              ))}
            </>}
          </div>
          <div className="dispatch-pane__head">
            <span>Sẵn sàng {taskTotals.ready} · Đã phát hành {taskTotals.dispatched}</span>
            <div>
              <button type="button" onClick={goToPreviousTaskPage} disabled={loading || taskPageIndex === 0}>Trang trước</button>
              <button type="button" onClick={goToNextTaskPage} disabled={loading || nextTaskCursor == null}>Trang sau</button>
            </div>
          </div>
        </section>

        <section className={`dispatch-pane dispatch-pane--fleet ${mobilePane === 'FLEET' ? 'is-mobile-active' : ''}`} aria-label="Đội xe">
          <div className="dispatch-pane__head">
            <strong>Đội xe sẵn sàng</strong>
            <span>{fleetAccessDenied ? 'Ẩn theo phân quyền' : `${fleet?.trucks.items.length ?? 0}/${fleet?.trucks.total ?? 0} đã tải · ${activeTrucks.length} sẵn sàng`}</span>
          </div>
          <div className="dispatch-pane__scroll">
            {fleetAccessDenied ? <EmptyState title="Không có quyền xem đội xe" description="Tài khoản hiện tại chỉ được xem tác vụ điều phối trong phạm vi cho phép." /> : activeTrucks.map((truck) => (
              <div key={truck.id} className="dispatch-fleet-row">
                <Truck size={19} />
                <div>
                  <strong>{truck.licensePlate}</strong>
                  <small>
                    {truck.currentTrailerPlate ? `Rơ-moóc ${truck.currentTrailerPlate}` : 'Chưa gắn rơ-moóc'}
                    {truck.capacityKg ? ` · Tải trọng ${truck.capacityKg} kg` : ''}
                    {truck.assignedDriverName ? ` · ${truck.assignedDriverName}` : ''}
                  </small>
                </div>
              </div>
            ))}
            {!fleetAccessDenied && fleet?.trucks.nextCursor ? (
              <button type="button" className="dispatch-fleet-load-more" onClick={() => void loadMoreTrucks()} disabled={truckSearch.loadingMore}>
                {truckSearch.loadingMore ? 'Đang tải…' : 'Tải thêm xe'}
              </button>
            ) : null}
            {canManageCarrierVehicles && (
              <div className="dispatch-assignment__carrier-context" style={{ margin: 12 }}>
                <strong>Danh mục xe nhà xe</strong>
                <SelectField
                  label="Nhà xe đối tác"
                  value={managedCarrierId}
                  onChange={(event) => {
                    const carrierId = event.target.value;
                    setManagedCarrierId(carrierId);
                    void refreshManagedVehicles(carrierId);
                  }}
                  disabled={managingVehicle}
                >
                  <option value="">— Chọn nhà xe —</option>
                  {(fleet?.externalCarriers.items ?? []).map((carrier) => (
                    <option key={carrier.id} value={carrier.id}>{carrier.name}</option>
                  ))}
                </SelectField>
                <TextField
                  label="Biển số xe mới"
                  value={managedPlate}
                  onChange={(event) => setManagedPlate(event.target.value)}
                  disabled={managingVehicle || !managedCarrierId}
                />
                <button type="button" onClick={() => void addManagedVehicle()} disabled={managingVehicle || !managedCarrierId || !managedPlate.trim()}>
                  Thêm xe
                </button>
                {managedVehicles.map((vehicle) => (
                  <div key={vehicle.id} className="dispatch-fleet-row">
                    <Truck size={18} />
                    <div><strong>{vehicle.licensePlate}</strong><small>{vehicle.isActive ? 'Đang hoạt động' : 'Tạm ngưng'}</small></div>
                    <button type="button" onClick={() => void toggleManagedVehicle(vehicle)} disabled={managingVehicle}>
                      {vehicle.isActive ? 'Tạm ngưng' : 'Kích hoạt'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className={`dispatch-pane dispatch-pane--detail ${mobilePane === 'DETAIL' ? 'is-mobile-active' : ''}`} aria-label="Chi tiết và phân xe">
          <div className="dispatch-pane__head"><strong>Chi tiết và phân xe</strong></div>
          <div className="dispatch-pane__scroll dispatch-detail">
            {!selected ? <EmptyState title="Chọn một tác vụ" description="Thông tin lô hàng và biểu mẫu phân xe sẽ hiển thị tại đây." /> : <>
              <div className="dispatch-detail__summary">
                <div className="dispatch-detail__title">
                  <span>Thông tin tác vụ</span>
                  <h2>{selected.unitSummary.label}</h2>
                </div>
                <div className="dispatch-detail__facts">
                  <DetailLine label="Khách hàng" value={selected.customer.name} />
                  <DetailLine label="Bill / Booking" value={selected.shipment.blNumber || selected.shipment.bookingRef} />
                  <DetailLine label="Tờ khai" value={selected.shipment.declarationNumbers.join(', ')} />
                  <DetailLine label="Tuyến" value={selected.route.name} />
                  <DetailLine label="Nhà máy" value={selected.operationalSite.name} />
                  <DetailLine label="Cảng nâng → Cảng hạ" value={[selected.unitSummary.pickupPortName, selected.unitSummary.dropoffPortName].filter(Boolean).join(' → ')} />
                  {selected.cargoMode === 'FCL' ? (
                    <DetailLine label="Số container / loại" value={[selected.unitSummary.containerNumber, selected.unitSummary.containerTypeLabel].filter(Boolean).join(' · ') || '—'} />
                  ) : (
                    <DetailLine label="Hàng lẻ" value={[
                      selected.unitSummary.packageCount ? `${selected.unitSummary.packageCount} ${selected.unitSummary.packageType || ''}`.trim() : null,
                      selected.unitSummary.cargoWeightKg ? `${Number(selected.unitSummary.cargoWeightKg).toLocaleString('vi-VN')} kg` : null,
                      selected.unitSummary.cargoVolumeCbm ? `${Number(selected.unitSummary.cargoVolumeCbm).toLocaleString('vi-VN')} CBM` : null,
                    ].filter(Boolean).join(' · ') || '—'} />
                  )}
                  {selected.unitSummary.shippingLineName && (
                    <DetailLine label="Hãng tàu" value={selected.unitSummary.shippingLineName} />
                  )}
                  <DetailLine label="Nhà xe đã gán" value={plannedCarrierLabel} />
                  <DetailLine label="Trạng thái điều xe" value={selected.taskStatus === 'DISPATCHED' ? selected.dispatch?.tripCode || 'Đã phát hành' : 'Chưa phát hành'} />
                </div>
                {(selected.operationalSite.strictRules || selected.shipment.operationalNotes) && (
                  <div className="dispatch-constraints">
                    <h3>Yêu cầu vận hành</h3>
                    {selected.operationalSite.strictRules && <div className="dispatch-site-rules"><strong>Quy định nhà máy</strong><p>{selected.operationalSite.strictRules}</p></div>}
                    {selected.shipment.operationalNotes && <div className="dispatch-note"><strong>Ghi chú điều xe</strong><p>{selected.shipment.operationalNotes}</p></div>}
                  </div>
                )}
              </div>
              <div className="dispatch-assignment">
                <div className="dispatch-assignment__title">
                  <span>Phân xe</span>
                  <h2>Phương tiện và lịch chạy</h2>
                </div>
                <div className="dispatch-assignment__carrier-context">
                  <span>{selected.cargoMode === 'FCL' ? 'Nhà xe đã gán' : 'Nhà xe điều phối'}</span>
                  <strong>{plannedCarrierLabel}</strong>
                  {plannedCarrier?.carrierType === 'EXTERNAL' && plannedCarrier.vehiclePlate ? (
                    <small>Xe đã gán trước đó: {plannedCarrier.vehiclePlate}</small>
                  ) : null}
                </div>
                <div className="dispatch-assignment__fields">
                  {selected.cargoMode === 'LCL' ? <>
                    <SelectField
                      label="Loại nhà xe"
                      value={assignment.carrierType}
                      onChange={(event) => setAssignment((current) => ({
                        ...current,
                        carrierType: event.target.value as AssignmentForm['carrierType'],
                        externalCarrierId: '',
                        externalVehicleId: '',
                        externalPlateNumber: '',
                      }))}
                      disabled={issuing}
                    >
                      <option value="OWN">Đội xe nội bộ SilverSea</option>
                      <option value="EXTERNAL">Nhà xe đối tác</option>
                    </SelectField>
                    {assignment.carrierType === 'EXTERNAL' ? (
                      <SelectField
                        label="Nhà xe đối tác"
                        value={assignment.externalCarrierId}
                        onChange={(event) => setAssignment((current) => ({
                          ...current,
                          externalCarrierId: event.target.value,
                          externalVehicleId: '',
                          externalPlateNumber: '',
                        }))}
                        disabled={issuing}
                      >
                        <option value="">— Chọn nhà xe —</option>
                        {(fleet?.externalCarriers.items ?? []).filter((carrier) => carrier.isActive !== false).map((carrier) => (
                          <option key={carrier.id} value={carrier.id}>{carrier.name}</option>
                        ))}
                      </SelectField>
                    ) : null}
                  </> : null}
                  {effectiveCarrier?.carrierType === 'OWN' ? <>
                    <div className="ds-field">
                      <label htmlFor="dispatch-truck" className="ds-field__label">Biển số xe</label>
                      <SearchableSelect
                        id="dispatch-truck"
                        value={assignment.truckId}
                        onChange={(truckId) => {
                          const suggestion = truckChoices.find((truck) => String(truck.id) === truckId);
                          rememberTruck(suggestion);
                          setAssignment((current) => ({
                            ...current,
                            truckId,
                            trailerId: suggestion?.currentTrailerId ? String(suggestion.currentTrailerId) : '',
                            driverId: '',
                          }));
                        }}
                        options={activeTrucks.map((truck) => ({ value: String(truck.id), label: truck.licensePlate }))}
                        onSearchChange={searchTrucks}
                        hasMore={Boolean(truckSearch.query ? truckSearch.nextCursor : fleet?.trucks.nextCursor)}
                        loadingMore={truckSearch.loadingMore}
                        onLoadMore={() => void loadMoreTrucks()}
                        placeholder="— Chọn xe —"
                        searchPlaceholder="Tìm biển số xe"
                        disabled={issuing || fleetAccessDenied}
                      />
                    </div>
                    <div className="ds-field">
                      <label htmlFor="dispatch-driver" className="ds-field__label">Lái xe</label>
                      <SearchableSelect
                        id="dispatch-driver"
                        value={assignment.driverId}
                        onChange={(driverId) => {
                          rememberDriver(driverChoices.find((driver) => String(driver.id) === driverId));
                          update('driverId', driverId);
                        }}
                        options={eligibleDrivers.map((driver) => ({ value: String(driver.id), label: driver.name, searchText: driver.phone ?? '' }))}
                        onSearchChange={searchDrivers}
                        hasMore={Boolean(driverSearch.query ? driverSearch.nextCursor : fleet?.drivers.nextCursor)}
                        loadingMore={driverSearch.loadingMore}
                        onLoadMore={() => void loadMoreDrivers()}
                        placeholder="— Chọn lái xe —"
                        searchPlaceholder="Tìm tên lái xe"
                        disabled={issuing || fleetAccessDenied}
                      />
                    </div>
                    <TextField className="dispatch-assignment__full" label="Rơ-moóc" value={truckChoices.find((truck) => String(truck.currentTrailerId) === assignment.trailerId)?.currentTrailerPlate ?? ''} disabled helpText="Tự điền theo xe; hệ thống kiểm tra lại khi phát lệnh." />
                  </> : effectiveCarrier?.carrierType === 'EXTERNAL' ? <>
                    <div className="ds-field dispatch-assignment__full">
                      <label htmlFor="dispatch-external-vehicle" className="ds-field__label">Xe của nhà xe</label>
                      <SearchableSelect
                        id="dispatch-external-vehicle"
                        value={assignment.externalVehicleId}
                        onChange={(externalVehicleId) => {
                          const vehicle = externalVehicleChoices.find((item) => String(item.id) === externalVehicleId);
                          setAssignment((current) => ({
                            ...current,
                            externalVehicleId,
                            externalPlateNumber: vehicle?.licensePlate ?? '',
                          }));
                        }}
                        options={activeExternalVehicles.map((vehicle) => ({ value: String(vehicle.id), label: vehicle.licensePlate }))}
                        onSearchChange={searchExternalVehicles}
                        hasMore={Boolean(externalVehicleSearch.nextCursor)}
                        loadingMore={externalVehicleSearch.loadingMore}
                        onLoadMore={() => void loadMoreExternalVehicles()}
                        placeholder="— Chọn xe của nhà xe —"
                        searchPlaceholder="Tìm biển số xe của nhà xe"
                        disabled={issuing || !effectiveCarrier.externalCarrierId}
                      />
                    </div>
                    <TextField
                      label={selected.cargoMode === 'FCL' ? 'Biển số đã chọn' : 'Biển số xe'}
                      value={assignment.externalPlateNumber}
                      onChange={selected.cargoMode === 'LCL' ? (event) => update('externalPlateNumber', event.target.value) : undefined}
                      disabled={issuing || selected.cargoMode === 'FCL'}
                    />
                    <TextField label="Tên lái xe" value={assignment.externalDriverName} onChange={(event) => update('externalDriverName', event.target.value)} disabled={issuing} />
                    <TextField className="dispatch-assignment__full" label="Số điện thoại lái xe" value={assignment.externalDriverPhone} onChange={(event) => update('externalDriverPhone', event.target.value)} disabled={issuing} />
                    {!externalVehicleLoading && activeExternalVehicles.length === 0 && !externalVehicleSearch.nextCursor ? (
                      <p className="dispatch-assignment__hint">
                        {selected.cargoMode === 'LCL'
                          ? 'Nhà xe chưa có xe trong danh mục; có thể nhập biển số thủ công.'
                          : 'Nhà xe đã gán chưa có xe hoạt động nào trong danh mục điều phối.'}
                      </p>
                    ) : null}
                  </> : (
                    <p className="dispatch-assignment__hint">Tác vụ này chưa được CUS gán nhà xe nên chưa thể phát hành lệnh điều xe.</p>
                  )}
                </div>
                <div className="dispatch-assignment__schedule">
                  <SelectField label="Lớp giá cước" value={assignment.pricingRateKey} onChange={(event) => update('pricingRateKey', event.target.value)} disabled={issuing} helpText={selected.cargoMode === 'FCL' ? 'Gợi ý theo cỡ container; chỉ đổi khi hợp đồng đã quy định.' : 'Chọn đúng hạng xe theo hợp đồng trước khi phát hành lệnh.'}>
                    <option value="">— Nhập giá thủ công nếu chưa có lớp giá —</option>
                    {PRICING_RATE_KEYS.map((key) => <option key={key} value={key}>{key}</option>)}
                  </SelectField>
                  <TextField label="Ngày giờ chạy" type="datetime-local" value={assignment.plannedStartAt} onChange={(event) => update('plannedStartAt', event.target.value)} disabled={issuing} />
                  <TextField label="Kết thúc dự kiến" type="datetime-local" value={assignment.plannedEndAt} onChange={(event) => update('plannedEndAt', event.target.value)} disabled={issuing || selected.route.serviceDurationMinutes != null} />
                </div>
                {selected.route.serviceDurationMinutes == null && <label className="dispatch-confirm"><input type="checkbox" checked={assignment.endTimeConfirmed} onChange={(event) => update('endTimeConfirmed', event.target.checked)} />Tôi xác nhận giờ kết thúc vì tuyến chưa có thời lượng chuẩn.</label>}
                {issueBlockedReason ? <p className="dispatch-assignment__hint dispatch-assignment__hint--danger">{issueBlockedReason}</p> : null}
                <button type="button" onClick={() => void issue()} disabled={issuing || issueBlockedReason != null} className="dispatch-issue">
                  <Send size={18} />{issuing ? 'Đang phát hành…' : 'Phát hành lệnh điều xe'}
                </button>
              </div>
            </>}
          </div>
        </section>
      </div>
    </div>
  );
}
