import { ApiError } from '../../errors';

export function parseActionId(value: string | string[] | undefined): number {
  const actionId = Number(value);
  if (!Number.isInteger(actionId) || actionId <= 0) {
    throw new ApiError(400, 'Mã yêu cầu không hợp lệ');
  }
  return actionId;
}
