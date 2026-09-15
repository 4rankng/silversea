import { userClient } from '../../api/userClient';
import type { UserRow } from '../users/utils';

/** Follow the user endpoint's page contract so eligible staff after page one
 * remain assignable. A failed page rejects the whole load, never a partial list. */
export async function loadOpsOwnerOptions(): Promise<UserRow[]> {
  const users = new Map<number, UserRow>();
  let page = 1;
  let received = 0;
  let total = Infinity;
  while (received < total) {
    const result = await userClient.getUsers({ role: 'OPS', page, limit: 100, sortBy: 'name', sortOrder: 'asc' });
    for (const user of result.items) users.set(user.id, user);
    received += result.items.length;
    total = result.total;
    if (result.items.length === 0) break;
    page += 1;
  }
  return [...users.values()];
}
