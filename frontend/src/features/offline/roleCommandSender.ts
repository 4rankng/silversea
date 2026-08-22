import { driverClient } from '../../api/driverClient';
import { forwarderClient } from '../../api/forwarderClient';
import { ApiError } from '../../lib/api';
import type { OfflineCommand, OfflineCommandSendResult } from '../driver/useOfflineCommandQueue';

type CommandPayload = Record<string, unknown> | null;

function numberField(payload: CommandPayload, field: string): number | null {
  const value = payload?.[field];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

export function classifyOfflineCommandError(error: unknown): OfflineCommandSendResult {
  if (error instanceof ApiError) {
    if (error.status === 409 || error.status === 428) {
      return { ok: false, kind: 'conflict', message: error.message };
    }
    if (error.status >= 500) {
      return { ok: false, kind: 'network', message: error.message };
    }
    return { ok: false, kind: 'rejected', message: error.message };
  }
  return {
    ok: false,
    kind: 'network',
    message: error instanceof Error ? error.message : 'Không thể đồng bộ lệnh.',
  };
}

export async function sendRoleOfflineCommand(command: OfflineCommand): Promise<OfflineCommandSendResult> {
  try {
    if (command.endpoint === 'driver.task.milestone') {
      const fulfillmentId = numberField(command.payload, 'fulfillmentId');
      const expectedVersion = numberField(command.payload, 'expectedVersion');
      const eventType = command.payload?.eventType;
      const occurredAt = command.payload?.occurredAt;
      if (!fulfillmentId || !expectedVersion || typeof eventType !== 'string' || typeof occurredAt !== 'string') {
        return { ok: false, kind: 'rejected', message: 'Lệnh cập nhật tiến độ không hợp lệ.' };
      }
      await driverClient.recordProgress(fulfillmentId, {
        eventType: eventType as Parameters<typeof driverClient.recordProgress>[1]['eventType'],
        occurredAt,
        expectedVersion,
        fulfillmentId,
      }, command.id);
      return { ok: true };
    }

    if (command.endpoint === 'driver.task.pod.submit') {
      const fulfillmentId = numberField(command.payload, 'fulfillmentId');
      const submissionId = numberField(command.payload, 'submissionId');
      const expectedVersion = numberField(command.payload, 'expectedVersion');
      if (!fulfillmentId || !submissionId || !expectedVersion) {
        return { ok: false, kind: 'rejected', message: 'Lệnh gửi e-POD không hợp lệ.' };
      }
      await driverClient.submitPod(fulfillmentId, submissionId, { expectedVersion }, command.id);
      return { ok: true };
    }

    if (command.endpoint === 'driver.task.complete') {
      const fulfillmentId = numberField(command.payload, 'fulfillmentId');
      const expectedVersion = numberField(command.payload, 'expectedVersion');
      if (!fulfillmentId || !expectedVersion) {
        return { ok: false, kind: 'rejected', message: 'Lệnh hoàn tất chuyến không hợp lệ.' };
      }
      await driverClient.completeTrip(fulfillmentId, { expectedVersion }, command.id);
      return { ok: true };
    }

    if (command.endpoint === 'forwarder.paper-order.collection') {
      const tripId = numberField(command.payload, 'tripId');
      const expectedVersion = numberField(command.payload, 'expectedVersion');
      if (!tripId || !expectedVersion) {
        return { ok: false, kind: 'rejected', message: 'Lệnh bàn giao lệnh giấy không hợp lệ.' };
      }
      await forwarderClient.collectPaperOrder(tripId, expectedVersion, command.id);
      return { ok: true };
    }

    if (command.endpoint === 'forwarder.order-exchange.start' || command.endpoint === 'forwarder.order-exchange.complete') {
      const shipmentId = numberField(command.payload, 'shipmentId');
      const expectedVersion = numberField(command.payload, 'expectedVersion');
      if (!shipmentId || !expectedVersion) {
        return { ok: false, kind: 'rejected', message: 'Lệnh đổi lệnh hãng tàu không hợp lệ.' };
      }
      if (command.endpoint === 'forwarder.order-exchange.start') {
        await forwarderClient.startOrderExchange(shipmentId, expectedVersion, command.id);
      } else {
        await forwarderClient.completeOrderExchange(shipmentId, expectedVersion, command.id);
      }
      return { ok: true };
    }

    return { ok: false, kind: 'rejected', message: 'Loại lệnh đồng bộ không được hỗ trợ.' };
  } catch (error) {
    return classifyOfflineCommandError(error);
  }
}
