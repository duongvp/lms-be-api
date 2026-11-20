import ApiError from '../../utils/ApiError';
export type AllocationTarget = { id: number; groupId: number; capacity: number; usernames: string[] };
const identity = (name: string) => name.trim().toLowerCase();
/** Stable existing placements take precedence. Overflow rejects the whole batch. */
export const allocateGroupUsers = (targets: AllocationTarget[], usernames: string[], preferences = new Map<string, number>()) => {
  const ordered = [...targets].sort((a,b) => a.groupId-b.groupId || a.id-b.id);
  const occupied = new Map(ordered.map(t => [t.id, new Set(t.usernames.map(identity))]));
  const assigned = new Set(ordered.flatMap(t => t.usernames.map(identity)));
  const additions: Array<{ username: string; calendarId: number }> = [];
  for (const username of [...new Map(usernames.map(n => [identity(n), n])).values()].sort((a,b) => identity(a).localeCompare(identity(b)))) {
    const key = identity(username);
    if (assigned.has(key)) continue;
    const preferred = preferences.get(key);
    // A known group is retained even when the operator did not select its calendar.
    if (preferred && !ordered.some(t => t.groupId === preferred)) continue;
    const available = ordered.filter(t => (!preferred || t.groupId === preferred) && occupied.get(t.id)!.size < t.capacity);
    const target = available[0];
    if (!target) throw new ApiError('Không đủ chỗ trong các nhóm đã chọn. Hãy bổ sung nhóm/lịch hoặc tăng sức chứa trước khi đồng bộ.', 409);
    occupied.get(target.id)!.add(key); assigned.add(key);
    additions.push({ username, calendarId: target.id });
  }
  return additions;
};
