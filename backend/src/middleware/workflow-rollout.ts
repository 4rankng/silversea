import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { ApiError } from '../errors';

export function assertWorkflowActive(): void {
  if (config.workflowRolloutMode !== 'ACTIVE') {
    throw new ApiError(503, 'Quy trình Customer Service - Tài chính chưa được kích hoạt');
  }
}

export function requireWorkflowActive(
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  try {
    assertWorkflowActive();
    next();
  } catch (error) {
    next(error);
  }
}
