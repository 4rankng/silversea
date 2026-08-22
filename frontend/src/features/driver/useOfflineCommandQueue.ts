import { useCallback, useEffect, useMemo, useState } from 'react';

export type OfflineCommandMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type OfflineCommandStatus = 'QUEUED' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'CONFLICT' | 'REJECTED';
export type OfflineCommandPayload = Record<string, unknown> | null;

export interface OfflineCommand<TPayload extends OfflineCommandPayload = OfflineCommandPayload> {
  id: string;
  endpoint: string;
  method: OfflineCommandMethod;
  path: string;
  payload: TPayload;
  fulfillmentScopeKey?: string;
  expectedVersion?: number;
  actionKind?: string;
  status: OfflineCommandStatus;
  retryCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OfflineCommandSendResult =
  | { ok: true; response?: unknown }
  | { ok: false; kind: 'network' | 'conflict' | 'rejected'; message?: string };

export type OfflineDrainResult = {
  done: number;
  failed: number;
  conflicts: number;
  rejected: number;
  statusById: Record<string, OfflineCommandStatus>;
  messageById: Record<string, string | null>;
};

type QueueListener = (commands: OfflineCommand[]) => void;

type QueueStore = {
  read(): OfflineCommand[];
  write(commands: OfflineCommand[]): void;
};

const STORAGE_KEY = 'silversea.driver-offline-command-queue.v1';
const TERMINAL_STATUSES: ReadonlySet<OfflineCommandStatus> = new Set(['DONE', 'CONFLICT', 'REJECTED']);

const memoryFallbackByKey = new Map<string, OfflineCommand[]>();
const persistentQueues = new Map<string, DriverOfflineCommandQueue>();

function createQueueStore(storageKey = STORAGE_KEY): QueueStore {
  return {
    read() {
      if (typeof window === 'undefined' || !('localStorage' in window)) {
        return [...(memoryFallbackByKey.get(storageKey) ?? [])];
      }
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((value): value is OfflineCommand => {
          if (!value || typeof value !== 'object') return false;
          const candidate = value as Partial<OfflineCommand>;
          return typeof candidate.id === 'string'
            && typeof candidate.endpoint === 'string'
            && typeof candidate.method === 'string'
            && typeof candidate.path === 'string'
            && typeof candidate.status === 'string'
            && typeof candidate.retryCount === 'number'
            && typeof candidate.createdAt === 'string'
            && typeof candidate.updatedAt === 'string';
        });
      } catch {
        return [...(memoryFallbackByKey.get(storageKey) ?? [])];
      }
    },
    write(commands) {
      memoryFallbackByKey.set(storageKey, [...commands]);
      if (typeof window === 'undefined' || !('localStorage' in window)) return;
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(commands));
      } catch {
        // Best-effort persistence only. In-memory fallback still keeps the queue
        // usable for the current session even when storage is unavailable/full.
      }
    },
  };
}

export function buildOfflineCommandKey(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? ''))
    .join(':')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

export class DriverOfflineCommandQueue {
  private readonly listeners = new Set<QueueListener>();

  private drainInFlight = false;

  constructor(private readonly store: QueueStore = createQueueStore()) {}

  listAll(): OfflineCommand[] {
    return this.store.read().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  listPending(): OfflineCommand[] {
    return this.listAll().filter((command) => !TERMINAL_STATUSES.has(command.status));
  }

  listVisible(): OfflineCommand[] {
    return this.listAll().filter((command) => command.status !== 'DONE');
  }

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.listVisible());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const pending = this.listVisible();
    for (const listener of this.listeners) {
      listener(pending);
    }
  }

  enqueue(
    input: {
      id?: string;
      endpoint: string;
      method: OfflineCommandMethod;
      path: string;
      payload?: OfflineCommandPayload;
      fulfillmentScopeKey?: string;
      expectedVersion?: number;
      actionKind?: string;
    },
    options?: { maxPending?: number },
  ): OfflineCommand {
    const commands = this.listAll();
    const pending = commands.filter((command) => !TERMINAL_STATUSES.has(command.status));
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const existingIndex = commands.findIndex((command) => command.id === id);
    const maxPending = options?.maxPending ?? 12;

    if (existingIndex === -1 && pending.length >= maxPending) {
      throw new Error('Hàng đợi ngoại tuyến đã đầy. Vui lòng kết nối mạng và thử gửi lại.');
    }

    const existing = existingIndex >= 0 ? commands[existingIndex] : null;
    const next: OfflineCommand = {
      id,
      endpoint: input.endpoint,
      method: input.method,
      path: input.path,
      payload: input.payload ?? null,
      fulfillmentScopeKey: input.fulfillmentScopeKey,
      expectedVersion: input.expectedVersion,
      actionKind: input.actionKind,
      status: 'QUEUED',
      retryCount: existing?.retryCount ?? 0,
      lastError: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    if (existingIndex >= 0) {
      commands.splice(existingIndex, 1, next);
    } else {
      commands.push(next);
    }

    this.store.write(commands);
    this.notify();
    return next;
  }

  remove(id: string): void {
    const commands = this.listAll().filter((command) => command.id !== id);
    this.store.write(commands);
    this.notify();
  }

  clear(): void {
    this.store.write([]);
    this.notify();
  }

  async drain(send: (command: OfflineCommand) => Promise<OfflineCommandSendResult>): Promise<OfflineDrainResult> {
    if (this.drainInFlight) {
      const commands = this.listAll();
      return Promise.resolve({ done: 0, failed: 0, conflicts: 0, rejected: 0, statusById: Object.fromEntries(commands.map((command) => [command.id, command.status])), messageById: Object.fromEntries(commands.map((command) => [command.id, command.lastError])) });
    }
    this.drainInFlight = true;

    let done = 0;
    let failed = 0;
    let conflicts = 0;
    let rejected = 0;

    try {
      const commands = this.listAll();
      const blockedScopes = new Set(
        commands
          .filter((command) => (command.status === 'CONFLICT' || command.status === 'REJECTED') && command.fulfillmentScopeKey)
          .map((command) => command.fulfillmentScopeKey as string),
      );
      for (const command of commands) {
        if (TERMINAL_STATUSES.has(command.status)) continue;
        if (command.fulfillmentScopeKey && blockedScopes.has(command.fulfillmentScopeKey)) continue;
        command.status = 'IN_PROGRESS';
        command.lastError = null;
        command.updatedAt = new Date().toISOString();
        this.store.write(commands);
        this.notify();

        let result: OfflineCommandSendResult;
        try {
          result = await send(command);
        } catch (error) {
          result = {
            ok: false,
            kind: 'network',
            message: error instanceof Error ? error.message : 'Lỗi mạng',
          };
        }

        if (result.ok) {
          command.status = 'DONE';
          command.lastError = null;
          done += 1;
        } else if (result.kind === 'conflict') {
          command.status = 'CONFLICT';
          command.lastError = result.message ?? 'Xung đột dữ liệu';
          if (command.fulfillmentScopeKey) blockedScopes.add(command.fulfillmentScopeKey);
          conflicts += 1;
        } else if (result.kind === 'rejected') {
          command.status = 'REJECTED';
          command.lastError = result.message ?? 'Máy chủ từ chối lệnh';
          if (command.fulfillmentScopeKey) blockedScopes.add(command.fulfillmentScopeKey);
          rejected += 1;
        } else {
          command.status = 'FAILED';
          command.retryCount += 1;
          command.lastError = result.message ?? 'Không thể gửi khi ngoại tuyến';
          if (command.fulfillmentScopeKey) blockedScopes.add(command.fulfillmentScopeKey);
          failed += 1;
        }
        command.updatedAt = new Date().toISOString();
        this.store.write(commands);
        this.notify();
      }

      return { done, failed, conflicts, rejected, statusById: Object.fromEntries(commands.map((command) => [command.id, command.status])), messageById: Object.fromEntries(commands.map((command) => [command.id, command.lastError])) };
    } finally {
      this.drainInFlight = false;
    }
  }
}

export const driverOfflineCommandQueue = new DriverOfflineCommandQueue();

function getPersistentQueue(storageScope: string): DriverOfflineCommandQueue {
  const storageKey = `${STORAGE_KEY}:${storageScope}`;
  const existing = persistentQueues.get(storageKey);
  if (existing) return existing;
  const created = new DriverOfflineCommandQueue(createQueueStore(storageKey));
  persistentQueues.set(storageKey, created);
  return created;
}

export function useOfflineCommandQueue(options?: {
  maxPending?: number;
  queue?: DriverOfflineCommandQueue;
  storageScope?: string | null;
}) {
  const queue = useMemo(() => {
    if (options?.queue) return options.queue;
    if (typeof options?.storageScope === 'string' && options.storageScope.trim().length > 0) {
      return getPersistentQueue(options.storageScope.trim());
    }
    return driverOfflineCommandQueue;
  }, [options?.queue, options?.storageScope]);
  const maxPending = options?.maxPending ?? 12;
  const [commands, setCommands] = useState<OfflineCommand[]>(() => queue.listVisible());

  useEffect(() => queue.subscribe(setCommands), [queue]);

  const enqueue = useCallback((input: {
    id?: string;
    endpoint: string;
    method: OfflineCommandMethod;
    path: string;
    payload?: OfflineCommandPayload;
    fulfillmentScopeKey?: string;
    expectedVersion?: number;
    actionKind?: string;
  }) => queue.enqueue(input, { maxPending }), [maxPending, queue]);

  const drain = useCallback((send: (command: OfflineCommand) => Promise<OfflineCommandSendResult>) => {
    return queue.drain(send);
  }, [queue]);

  const remove = useCallback((id: string) => {
    queue.remove(id);
  }, [queue]);

  const clear = useCallback(() => {
    queue.clear();
  }, [queue]);

  const summary = useMemo(() => ({
    pendingCount: commands.filter((command) => command.status === 'QUEUED' || command.status === 'IN_PROGRESS').length,
    failedCount: commands.filter((command) => command.status === 'FAILED').length,
    conflictCount: commands.filter((command) => command.status === 'CONFLICT').length,
    rejectedCount: commands.filter((command) => command.status === 'REJECTED').length,
  }), [commands]);

  return {
    commands,
    enqueue,
    drain,
    remove,
    clear,
    ...summary,
  };
}

export function createMemoryCommandQueue(): DriverOfflineCommandQueue {
  let commands: OfflineCommand[] = [];
  return new DriverOfflineCommandQueue({
    read: () => [...commands],
    write: (next) => {
      commands = [...next];
    },
  });
}
