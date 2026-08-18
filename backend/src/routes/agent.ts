// Agent routes — the command-and-insight assistant surface.
//
// The live chat transport is socket.io (`agentSocket.ts`, `/agent` namespace) —
// it streams AgentEvent frames (tool activity, directives, then `done` with the
// final response) over a socket instead of an SSE HTTP request. These REST
// routes only carry conversation history:
//   GET  /conversations     — the user's recent conversations (sidebar history).
//   GET  /conversations/:id — full message history for one conversation.
//
// Auth/mount: `app.use('/api/agent', authMiddleware, casbinAuthz('agent'), …)`
// — the bot impersonates the caller; Casbin gates office roles. A 503 is
// returned for every route while BOT_ENABLE is off.
import { Router, type Request, type Response } from 'express';
import { getAppSettings } from '../services/app-settings.service';
import { getUser } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import {
  getConversationHistory,
  listRecentConversations,
} from '../services/agent/conversations';

export const agentRoutes = Router();

/** 503 when the feature flag is off — launcher is hidden client-side too. */
async function disabled(res: Response): Promise<boolean> {
  if (!(await getAppSettings()).botEnabled) {
    res.status(503).json({ enabled: false, message: 'Trợ lý chưa được bật' });
    return true;
  }
  return false;
}

agentRoutes.get('/conversations', asyncHandler(async (req: Request, res: Response) => {
  if (await disabled(res)) return;
  res.json(await listRecentConversations(getUser(req).userId));
}));

agentRoutes.get('/conversations/:id', asyncHandler(async (req: Request, res: Response) => {
  if (await disabled(res)) return;
  const id = Number(req.params.id);
  const result = await getConversationHistory(id, getUser(req).userId);
  if (!result) {
    return res.status(404).json({ error: 'Không tìm thấy' });
  }
  res.json(result);
}));
