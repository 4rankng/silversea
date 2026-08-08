import type { Request, Response, NextFunction } from 'express';
import { getForwarderByUserId } from '../services/forwarder.service';
import { getUser } from './auth';

interface ForwarderProfile {
  id: number;
  username: string | null;
  fullName: string | null;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      forwarder?: ForwarderProfile;
    }
  }
}

/**
 * Middleware that resolves the forwarder profile for the authenticated user
 * and attaches it to `req.forwarder`. Eliminates repeated lookups per handler.
 *
 * Must be mounted AFTER authMiddleware (requires req.user).
 * Throws 404 via NoForwarderProfileError if user has no OPS role (formerly FORWARDER) profile.
 */
export async function resolveForwarder(req: Request, _res: Response, next: NextFunction) {
  try {
    req.forwarder = await getForwarderByUserId(getUser(req).userId);
    next();
  } catch (err) {
    next(err);
  }
}
