import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { createEvgLiveStream } from '../../integrations/evg-live-stream.service';
import {
  buildCalendarRoomClassId,
  excelDateSerialFromCalendarDate,
} from './calendar-user-sync.service';

const EVG_ROOM_COUNT = 25;
const EVG_PLAYBACK_BASE_URL = 'https://evg-stream.hocmai.net/live';
export type EvgProvisionMode = 'skip_existing' | 'overwrite';

export const buildEvgPlaybackUrl = (streamAlias: string) => {
  const normalizedStreamAlias = String(streamAlias || '').trim();
  if (!normalizedStreamAlias) throw new Error('EVG stream alias không hợp lệ');
  return `${EVG_PLAYBACK_BASE_URL}/${normalizedStreamAlias}/playlist.m3u8`;
};

export const extractEvgStreamAlias = (value: unknown) => {
  const text = String(value || '').trim();
  const prefix = `${EVG_PLAYBACK_BASE_URL}/`;
  const suffix = '/playlist.m3u8';
  return text.startsWith(prefix) && text.endsWith(suffix)
    ? text.slice(prefix.length, -suffix.length).trim()
    : '';
};

const normalizeEvgNamePart = (value: unknown) => String(value ?? '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

export const buildEvgStreamName = (code: string, learnNumber: number, startTime: Date | string) => {
  const normalizedCode = normalizeEvgNamePart(code);
  if (!normalizedCode) throw new Error('Lịch học chưa có code hợp lệ để tạo EVG');
  if (!Number.isInteger(learnNumber) || learnNumber <= 0) {
    throw new Error('Lịch học chưa có learn_number hợp lệ để tạo EVG');
  }
  return `${normalizedCode}-${learnNumber}-${excelDateSerialFromCalendarDate(startTime)}`;
};

const objectConfig = (value: Prisma.JsonValue | null | undefined): Prisma.JsonObject => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Prisma.JsonObject) } as Prisma.JsonObject
    : {}
);

export const provisionCalendarEvgStream = async (
  calendarId: number,
  actorUsername: string,
  mode: EvgProvisionMode = 'skip_existing'
) => {
  if (!Number.isInteger(calendarId) || calendarId <= 0) throw new Error('ID lịch học không hợp lệ');
  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) throw new Error('Không tìm thấy lịch học');
  if (Number(calendar.lesson_status ?? 0) === 1) throw new Error('Không tạo EVG cho lịch đã nghỉ học');

  if (!['skip_existing', 'overwrite'].includes(mode)) throw new Error('Chế độ xử lý EVG không hợp lệ');
  if (calendar.evg_stream && mode === 'skip_existing') {
    return { skipped: true, operation: 'skipped', reason: 'Lịch học đã có EVG', calendar };
  }
  const requestName = buildEvgStreamName(calendar.code, calendar.learn_number, calendar.start_time);
  // EVG hiện chỉ cung cấp API create. Chế độ ghi đè vì vậy luôn tạo stream
  // mới; chế độ bỏ qua chỉ gọi create khi calendar chưa có evg_stream.
  const evg = await createEvgLiveStream(requestName);
  const evgPlaybackUrl = buildEvgPlaybackUrl(evg.streamAlias);

  const result = await prisma.$transaction(async (tx) => {
    const latest = await tx.calendar.findUnique({ where: { id: calendarId } });
    if (!latest) throw new Error('Lịch học không còn tồn tại');
    if (mode === 'skip_existing' && latest.evg_stream) {
      throw new Error('Lịch học vừa được tạo EVG bởi một yêu cầu khác');
    }

    const updatedCalendar = await tx.calendar.update({
      where: { id: calendarId },
      data: {
        channel_name: evg.name,
        evg_stream: evg.id,
        lesson_link: evg.streamKey,
        updated_at: new Date(),
      },
    });

    const existingRooms = await tx.stream.findMany({
      where: {
        code: latest.code,
        learn_number: latest.learn_number,
        room_id: { in: Array.from({ length: EVG_ROOM_COUNT }, (_, index) => index + 1) },
      },
      select: { room_id: true },
    });
    const existingRoomIds = new Set(existingRooms.map((item) => item.room_id));
    let created = 0;
    let updated = 0;
    for (let roomId = 1; roomId <= EVG_ROOM_COUNT; roomId += 1) {
      await tx.stream.upsert({
        where: { code_learn_number_room_id: {
          code: latest.code,
          learn_number: latest.learn_number,
          room_id: roomId,
        } },
        create: {
          code: latest.code,
          learn_number: latest.learn_number,
          room_id: roomId,
          stream_key: evgPlaybackUrl,
          banner_url: latest.evg_banner,
          type: 1,
          class_id: buildCalendarRoomClassId(latest.code, latest.start_time, latest.learn_number, roomId),
        },
        update: {
          stream_key: evgPlaybackUrl,
          banner_url: latest.evg_banner,
          type: 1,
          class_id: buildCalendarRoomClassId(latest.code, latest.start_time, latest.learn_number, roomId),
          updated_at: new Date(),
        },
      });
      if (existingRoomIds.has(roomId)) updated += 1; else created += 1;
    }

    const currentRoomConfig = await tx.room_config.findUnique({
      where: { code_learn_number: { code: latest.code, learn_number: latest.learn_number } },
    });
    const config = {
      ...objectConfig(currentRoomConfig?.config),
      evg: 'evg',
      stream_key: evg.streamKey,
    } as Prisma.InputJsonObject;
    await tx.room_config.upsert({
      where: { code_learn_number: { code: latest.code, learn_number: latest.learn_number } },
      create: {
        code: latest.code,
        learn_number: latest.learn_number,
        config,
        updated_by: actorUsername || 'system',
        updated_at: new Date(),
      },
      update: { config, updated_by: actorUsername || 'system', updated_at: new Date() },
    });

    return { updatedCalendar, created, updated };
  }, { maxWait: 10_000, timeout: 60_000 });

  return {
    skipped: false,
    operation: mode === 'overwrite' ? 'overwritten' : 'created',
    calendar_id: calendarId,
    name: evg.name,
    evg_stream_id: evg.id,
    stream_alias: evg.streamAlias,
    rooms_created: result.created,
    rooms_updated: result.updated,
    room_config_updated: true,
    calendar: result.updatedCalendar,
  };
};

export const provisionCalendarsEvgBulk = async (
  calendarIds: number[],
  actorUsername: string,
  mode: EvgProvisionMode = 'skip_existing'
) => {
  const ids = Array.from(new Set(calendarIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) throw new Error('Vui lòng chọn ít nhất một lịch học');
  if (ids.length > 100) throw new Error('Chỉ được xử lý tối đa 100 lịch mỗi lần');

  const results: Array<{ calendar_id: number; success: boolean; data?: any; error?: string }> = [];
  // EVG giới hạn tần suất tạo stream và trả HTTP 429 khi gọi dồn. Xử lý tuần
  // tự để endpoint bulk cũng an toàn khi được gọi trực tiếp ngoài giao diện.
  const concurrency = 1;
  for (let index = 0; index < ids.length; index += concurrency) {
    const batch = ids.slice(index, index + concurrency);
    results.push(...await Promise.all(batch.map(async (calendarId) => {
      try {
        return {
          calendar_id: calendarId,
          success: true,
          data: await provisionCalendarEvgStream(calendarId, actorUsername, mode),
        };
      } catch (error: any) {
        return { calendar_id: calendarId, success: false, error: String(error?.message || error) };
      }
    })));
  }
  return {
    mode,
    total: results.length,
    succeeded: results.filter((item) => item.success).length,
    failed: results.filter((item) => !item.success).length,
    results,
  };
};
