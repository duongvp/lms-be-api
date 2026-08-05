import {
  CalendarChangeItem,
  CalendarNotificationPayload,
  TeamsCalendarEventType,
} from './teams-notification.types';

const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const EMPTY_VALUE = '—';

const asWallClockParts = (value: unknown) => {
  if (!value) return null;
  const normalized = value instanceof Date ? value.toISOString() : String(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!match) return null;
  return {
    year: match[1],
    month: match[2],
    day: match[3],
    hour: match[4],
    minute: match[5],
  };
};

const asDate = (value: unknown) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatChangedDate = (value: unknown) => {
  const date = asDate(value);
  return date
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: TIME_ZONE,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date)
    : EMPTY_VALUE;
};

const formatChangedTime = (value: unknown) => {
  const date = asDate(value);
  return date
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date)
    : EMPTY_VALUE;
};

// start_time/end_time trong calendar là giờ nghiệp vụ Việt Nam (wall-clock).
// Chỉ đọc nguyên các thành phần đã lưu, không quy đổi timezone thêm lần nữa.
const formatScheduleDate = (value: unknown) => {
  const parts = asWallClockParts(value);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : EMPTY_VALUE;
};

const formatScheduleTime = (value: unknown) => {
  const parts = asWallClockParts(value);
  return parts ? `${parts.hour}:${parts.minute}` : EMPTY_VALUE;
};

const text = (value: unknown) => {
  const normalized = String(value ?? '').trim();
  return normalized || EMPTY_VALUE;
};

const EVENT_TITLES: Record<TeamsCalendarEventType, string> = {
  created: 'Đã thêm lịch học',
  updated: 'Lịch học đã được cập nhật',
  cancelled: 'Lịch học đã bị hủy',
  deleted: 'Lịch học đã bị xóa',
};

export const buildCalendarChanges = (
  before: Record<string, any> | null,
  after: Record<string, any> | null
): CalendarChangeItem[] => {
  if (!before || !after) return [];
  const changes: CalendarChangeItem[] = [];
  const add = (label: string, oldValue: string, newValue: string) => {
    if (oldValue !== newValue) changes.push({ label, before: oldValue, after: newValue });
  };

  add('Tên môn học', text(before.subject), text(after.subject));
  add('Lớp học', text(before.code), text(after.code));
  add('Giảng viên', text(before.teacher), text(after.teacher));
  add('Trợ giảng', text(before.assistant_teacher), text(after.assistant_teacher));
  add('Ngày học', formatScheduleDate(before.start_time), formatScheduleDate(after.start_time));
  add(
    'Thời gian',
    `${formatScheduleTime(before.start_time)} – ${formatScheduleTime(before.end_time)}`,
    `${formatScheduleTime(after.start_time)} – ${formatScheduleTime(after.end_time)}`
  );
  add('Phòng học', text(before.channel_name), text(after.channel_name));
  add('Tên bài học', text(before.lesson_name), text(after.lesson_name));
  add('Trạng thái', text(before.lesson_status), text(after.lesson_status));
  return changes;
};

export const buildTeamsAdaptiveCard = (payload: CalendarNotificationPayload) => {
  const calendar = payload.after || payload.before || {};
  const actor = payload.actor?.username || EMPTY_VALUE;
  const teacherName = String(calendar.teacher ?? '')
    .trim()
    .replace(/^(cô|thầy)\s+/i, '');
  const teacherGreeting = teacherName
    ? `Cô @${teacherName} ơi, lịch học vừa có thay đổi. Cô vui lòng kiểm tra thông tin bên dưới nhé.`
    : 'Lịch học vừa có thay đổi. Vui lòng kiểm tra thông tin bên dưới.';
  const facts = [
    { title: 'Tên môn học', value: text(calendar.subject) },
    { title: 'Lớp học', value: text(calendar.code) },
    { title: 'Giảng viên', value: text(calendar.teacher) },
    { title: 'Ngày học', value: formatScheduleDate(calendar.start_time) },
    {
      title: 'Thời gian',
      value: `${formatScheduleTime(calendar.start_time)} – ${formatScheduleTime(calendar.end_time)}`,
    },
    { title: 'Phòng học', value: text(calendar.channel_name) },
    { title: 'Người thực hiện', value: actor },
    { title: 'Thời gian thay đổi', value: `${formatChangedDate(payload.changedAt)} ${formatChangedTime(payload.changedAt)}` },
  ];
  const changeBlocks = payload.changes.length
    ? [
        {
          type: 'TextBlock',
          text: 'Thông tin thay đổi',
          weight: 'Bolder',
          spacing: 'Medium',
        },
        ...payload.changes.map((change) => ({
          type: 'TextBlock',
          text: `**${change.label}:** ${change.before} → ${change.after}`,
          wrap: true,
          spacing: 'Small',
        })),
      ]
    : [];

  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: EVENT_TITLES[payload.eventType],
            size: 'Large',
            weight: 'Bolder',
            wrap: true,
          },
          {
            type: 'TextBlock',
            text: teacherGreeting,
            wrap: true,
            spacing: 'Small',
          },
          { type: 'FactSet', facts },
          ...changeBlocks,
        ],
      },
    }],
  };
};
