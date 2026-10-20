import type { PrismaClient } from '@prisma/client';
import { buildCalendarRoomClassId } from './calendar-user-sync.service';

export const EVG_MIN_ROOM_COUNT = 25;
type CalendarEvgRecord = {
  id: number;
  code: string;
  learn_number: number;
  start_time: Date;
  evg_stream?: string | null;
  lesson_link?: string | null;
  channel_name?: string | null;
};
export type CalendarEvgStatus = {
  evg_provisioned: boolean;
  evg_provisioning_status: 'not_created' | 'incomplete' | 'ready';
};
const text = (value: unknown) => String(value ?? '').trim();
const hasStreamId = (value: unknown) => Boolean(text(value)) && !/^(0|null|undefined|false)$/i.test(text(value));
const pairKey = (code: string, learnNumber: number) => JSON.stringify([code, learnNumber]);

/** Kiểm tra trạng thái đã lưu, không gọi API EVG và không suy diễn từ ID trên calendar. */
export const getCalendarEvgStatuses = async (
  client: Pick<PrismaClient, 'stream' | 'room_config'>,
  calendars: CalendarEvgRecord[],
) => {
  const statuses = new Map<number, CalendarEvgStatus>(calendars.map((calendar) => [calendar.id, {
    evg_provisioned: false,
    evg_provisioning_status: hasStreamId(calendar.evg_stream) ? 'incomplete' : 'not_created',
  }]));
  const candidates = calendars.filter((calendar) => hasStreamId(calendar.evg_stream)
    && text(calendar.lesson_link) && text(calendar.channel_name));
  if (!candidates.length) return statuses;
  const pairs = Array.from(new Map(candidates.map((calendar) => [pairKey(calendar.code, calendar.learn_number), {
    code: calendar.code, learn_number: calendar.learn_number,
  }])).values());
  const [rooms, configs] = await Promise.all([
    client.stream.findMany({ where: { OR: pairs }, select: { code: true, learn_number: true, room_id: true, stream_key: true, banner_url: true, class_id: true } }),
    client.room_config.findMany({ where: { OR: pairs }, select: { code: true, learn_number: true, config: true } }),
  ]);
  const configsByPair = new Map(configs.map((config) => [pairKey(config.code, config.learn_number), config.config]));
  const roomsByPair = new Map<string, typeof rooms>();
  for (const room of rooms) {
    const key = pairKey(room.code, room.learn_number);
    const group = roomsByPair.get(key) || [];
    group.push(room);
    roomsByPair.set(key, group);
  }
  for (const calendar of candidates) {
    const key = pairKey(calendar.code, calendar.learn_number);
    const config = configsByPair.get(key);
    if (!config || typeof config !== 'object' || Array.isArray(config)
      || config.evg !== 'evg' || config.stream_key !== calendar.lesson_link) continue;
    const matchingRooms = (roomsByPair.get(key) || []).filter((room) => Number(room.room_id) > 0
      && /^https:\/\/evg-stream\.hocmai\.net\/live\/[^/]+\/playlist\.m3u8$/.test(text(room.stream_key))
      && text(room.banner_url)
      && room.class_id === buildCalendarRoomClassId(calendar.code, calendar.start_time, calendar.learn_number, Number(room.room_id)));
    const roomIds = new Set(matchingRooms.map((room) => Number(room.room_id)));
    const hasAllRooms = Array.from({ length: EVG_MIN_ROOM_COUNT }, (_, index) => index + 1).every((roomId) => roomIds.has(roomId));
    if (hasAllRooms && new Set(matchingRooms.map((room) => room.stream_key)).size === 1) {
      statuses.set(calendar.id, { evg_provisioned: true, evg_provisioning_status: 'ready' });
    }
  }
  return statuses;
};
