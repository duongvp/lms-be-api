"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCalendarEvgStatuses = exports.EVG_MIN_ROOM_COUNT = void 0;
const calendar_user_sync_service_1 = require("./calendar-user-sync.service");
exports.EVG_MIN_ROOM_COUNT = 25;
const text = (value) => String(value ?? '').trim();
const hasStreamId = (value) => Boolean(text(value)) && !/^(0|null|undefined|false)$/i.test(text(value));
const pairKey = (code, learnNumber) => JSON.stringify([code, learnNumber]);
/** Kiểm tra trạng thái đã lưu, không gọi API EVG và không suy diễn từ ID trên calendar. */
const getCalendarEvgStatuses = async (client, calendars) => {
    const statuses = new Map(calendars.map((calendar) => [calendar.id, {
            evg_provisioned: false,
            evg_provisioning_status: hasStreamId(calendar.evg_stream) ? 'incomplete' : 'not_created',
        }]));
    const candidates = calendars.filter((calendar) => hasStreamId(calendar.evg_stream)
        && text(calendar.lesson_link) && text(calendar.channel_name));
    if (!candidates.length)
        return statuses;
    const pairs = Array.from(new Map(candidates.map((calendar) => [pairKey(calendar.code, calendar.learn_number), {
            code: calendar.code, learn_number: calendar.learn_number,
        }])).values());
    const [rooms, configs] = await Promise.all([
        client.stream.findMany({ where: { OR: pairs }, select: { code: true, learn_number: true, room_id: true, stream_key: true, banner_url: true, class_id: true } }),
        client.room_config.findMany({ where: { OR: pairs }, select: { code: true, learn_number: true, config: true } }),
    ]);
    const configsByPair = new Map(configs.map((config) => [pairKey(config.code, config.learn_number), config.config]));
    const roomsByPair = new Map();
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
            || config.evg !== 'evg' || config.stream_key !== calendar.lesson_link)
            continue;
        const matchingRooms = (roomsByPair.get(key) || []).filter((room) => Number(room.room_id) > 0
            && /^https:\/\/evg-stream\.hocmai\.net\/live\/[^/]+\/playlist\.m3u8$/.test(text(room.stream_key))
            && text(room.banner_url)
            && room.class_id === (0, calendar_user_sync_service_1.buildCalendarRoomClassId)(calendar.code, calendar.start_time, calendar.learn_number, Number(room.room_id)));
        const roomIds = new Set(matchingRooms.map((room) => Number(room.room_id)));
        const hasAllRooms = Array.from({ length: exports.EVG_MIN_ROOM_COUNT }, (_, index) => index + 1).every((roomId) => roomIds.has(roomId));
        if (hasAllRooms && new Set(matchingRooms.map((room) => room.stream_key)).size === 1) {
            statuses.set(calendar.id, { evg_provisioned: true, evg_provisioning_status: 'ready' });
        }
    }
    return statuses;
};
exports.getCalendarEvgStatuses = getCalendarEvgStatuses;
