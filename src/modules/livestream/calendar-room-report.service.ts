import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx-js-style';
import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';
import { buildCalendarRoomClassId } from './calendar-user-sync.service';
import { calendarSourceFromCode } from './calendar-source';
import { getVietnamWallClockDate } from '../../utils/dateTime';

type ReportCalendar = {
  id: number; code: string; learn_number: number; lesson_name?: string | null;
  teacher?: string | null; assistant_teacher?: string | null; system_type?: string | null; start_time: Date; end_time: Date;
  evg_stream?: string | null; channel_name?: string | null; lesson_status?: number | null;
};
type Callback = { calendar_id: number; live_session_id: string | null; start_on: Date | null; end_on: Date | null };
export type ReportWindow = {
  key: string; calendar: ReportCalendar; session_id: string | null;
  actual_start_time: Date | null; actual_end_time: Date | null; from: Date; to: Date;
};
type RoomCount = { window_id: string; room_id: number | null; added_students: number | bigint; attended_students: number | bigint };
type ReportEnrollment = { window_id: string; user_id: number; username: string; student_hmid: string | null; room_id: number | null };
type ReportActivity = { window_id: string; activity_id: bigint | number; created_at: Date; status: number | null; username: string; name?: string | null; student_hmid?: string | null };
type LogActivity = Omit<ReportActivity, 'window_id'> & { code: string; learn_number: number };

/** Các buổi trùng giờ dùng một lần quét log theo index thời gian đang có. */
export const groupReportWindows = (windows: ReportWindow[]) => {
  const groups: Array<{ from: Date; to: Date; windows: ReportWindow[] }> = [];
  for (const window of [...windows].filter((item) => item.from < item.to).sort((a, b) => a.from.getTime() - b.from.getTime())) {
    const last = groups[groups.length - 1];
    if (last && window.from <= last.to) {
      last.windows.push(window);
      if (window.to > last.to) last.to = window.to;
    } else groups.push({ from: window.from, to: window.to, windows: [window] });
  }
  return groups;
};

/** Hai status=2 liên tiếp; status=1 (join lại) hoặc status khác ngắt chuỗi. */
const createAttendanceCounter = (enrollments: ReportEnrollment[]) => {
  const normalize = (value: string | null) => (value || '').trim().toLowerCase();
  const byUsername = new Map<string, number[]>();
  const byHmid = new Map<string, number[]>();
  const identity = (windowId: string, value: string) => JSON.stringify([windowId, value]);
  const addIdentity = (index: Map<string, number[]>, key: string, student: number) => {
    const matches = index.get(key);
    if (matches) matches.push(student);
    else index.set(key, [student]);
  };
  enrollments.forEach((student, index) => {
    addIdentity(byUsername, identity(student.window_id, normalize(student.username)), index);
    const hmid = normalize(student.student_hmid);
    if (hmid) addIdentity(byHmid, identity(student.window_id, hmid), index);
  });
  const previous = new Array<number | null | undefined>(enrollments.length);
  const attended = new Set<number>();
  const add = (activities: ReportActivity[]) => {
    // Sắp xếp ở backend, không cần bảng tạm UNION DISTINCT + window function ở DB.
    activities.sort((left, right) => left.created_at.getTime() - right.created_at.getTime()
      || (left.activity_id < right.activity_id ? -1 : left.activity_id > right.activity_id ? 1 : 0));
    for (const activity of activities) {
      const hmid = normalize(activity.student_hmid ?? activity.name?.split(' - ')[0] ?? null);
      const matches = new Set([
        ...(byUsername.get(identity(activity.window_id, normalize(activity.username))) || []),
        ...(hmid ? byHmid.get(identity(activity.window_id, hmid)) || [] : []),
      ]);
      // Một log khớp cả username và HMID chỉ cập nhật chuỗi một lần.
      for (const index of matches) {
        if (activity.status === 2 && previous[index] === 2) attended.add(index);
        previous[index] = activity.status;
      }
    }
  };
  const result = (): RoomCount[] => {
    const counts = new Map<string, RoomCount>();
    enrollments.forEach((student, index) => {
      const key = JSON.stringify([student.window_id, student.room_id]);
      const count = counts.get(key) || { window_id: student.window_id, room_id: student.room_id, added_students: 0, attended_students: 0 };
      count.added_students = Number(count.added_students) + 1;
      if (attended.has(index)) count.attended_students = Number(count.attended_students) + 1;
      counts.set(key, count);
    });
    return [...counts.values()];
  };
  return { add, result };
};

export const countConsecutiveAttendance = (enrollments: ReportEnrollment[], activities: ReportActivity[]): RoomCount[] => {
  const counter = createAttendanceCounter(enrollments);
  counter.add(activities);
  return counter.result();
};
export type CalendarRoomReportRow = {
  key: string; calendar_id: number; code: string; calendar_source: string; learn_number: number;
  lesson_name: string; teacher: string; system_type: string; lesson_status: number;
  scheduled_start_time: string; scheduled_end_time: string; session_id: string | null;
  actual_start_time: string | null; actual_end_time: string | null;
  room_id: number | null; class_id: string | null; added_students: number; attended_students: number;
};
const iso = (value: Date | null) => value?.toISOString() ?? null;

/** Gộp webhook mở/đóng cùng session, không dùng giờ kế hoạch làm giờ thực tế. */
export const buildReportWindows = (calendars: ReportCalendar[], callbacks: Callback[], now = getVietnamWallClockDate()) => calendars.flatMap((calendar) => {
  const sessions = new Map<string, { session_id: string | null; start: Date | null; end: Date | null }>();
  for (const callback of callbacks.filter((item) => Number(item.calendar_id) === calendar.id)) {
    if (!callback.start_on && !callback.end_on) continue;
    // Không đoán cặp mở/đóng khi webhook thiếu Session ID.
    if (!callback.live_session_id && (!callback.start_on || !callback.end_on)) continue;
    const key = callback.live_session_id || `range:${iso(callback.start_on)}:${iso(callback.end_on)}`;
    const current = sessions.get(key) || { session_id: callback.live_session_id, start: null, end: null };
    if (callback.start_on && (!current.start || callback.start_on < current.start)) current.start = callback.start_on;
    if (callback.end_on && (!current.end || callback.end_on > current.end)) current.end = callback.end_on;
    sessions.set(key, current);
  }
  if (!sessions.size) sessions.set('unrecorded', { session_id: null, start: null, end: null });
  return Array.from(sessions.entries()).map(([sessionKey, session]) => ({
    key: `${calendar.id}:${sessionKey}`, calendar, session_id: session.session_id,
    actual_start_time: session.start, actual_end_time: session.end,
    from: session.start || calendar.start_time,
    to: session.end || new Date(Math.min(calendar.end_time.getTime(), now.getTime())),
  }));
});

export const assembleRoomReport = (windows: ReportWindow[], counts: RoomCount[]): CalendarRoomReportRow[] => windows.flatMap((window) => {
  const roomCounts = counts.filter((count) => count.window_id === window.key)
    .sort((left, right) => {
      if (left.room_id == null) return right.room_id == null ? 0 : 1;
      if (right.room_id == null) return -1;
      return Number(left.room_id) - Number(right.room_id);
    });
  return (roomCounts.length ? roomCounts : [{ window_id: window.key, room_id: null, added_students: 0, attended_students: 0 }]).map((count) => {
    const roomId = count.room_id == null ? null : Number(count.room_id);
    const calendar = window.calendar;
    return {
      key: `${window.key}:${roomId ?? 'unassigned'}`, calendar_id: calendar.id, code: calendar.code,
      calendar_source: calendarSourceFromCode(calendar.code), learn_number: calendar.learn_number,
      lesson_name: calendar.lesson_name || '', teacher: calendar.teacher || '', system_type: calendar.system_type || '',
      lesson_status: Number(calendar.lesson_status || 0),
      scheduled_start_time: calendar.start_time.toISOString(), scheduled_end_time: calendar.end_time.toISOString(),
      session_id: window.session_id, actual_start_time: iso(window.actual_start_time), actual_end_time: iso(window.actual_end_time),
      room_id: roomId, class_id: roomId == null ? null : buildCalendarRoomClassId(calendar.code, calendar.start_time, calendar.learn_number, roomId),
      added_students: Number(count.added_students), attended_students: Number(count.attended_students),
    };
  });
});

/** Mỗi học sinh thuộc đúng một room (hoặc chưa chia) trong một session. */
export const assembleProgramReport = (windows: ReportWindow[], counts: RoomCount[]): CalendarRoomReportRow[] => {
  const totals = new Map<string, RoomCount>();
  for (const count of counts) {
    const total = totals.get(count.window_id) || { window_id: count.window_id, room_id: null, added_students: 0, attended_students: 0 };
    total.added_students = Number(total.added_students) + Number(count.added_students);
    total.attended_students = Number(total.attended_students) + Number(count.attended_students);
    totals.set(count.window_id, total);
  }
  return assembleRoomReport(windows, [...totals.values()]).map((row, index) => ({ ...row, key: windows[index].key }));
};

const queryRoomReport = async (calendars: ReportCalendar[], client = prisma, groupByRoom = false) => {
  if (!calendars.length) return [];
  const channelIds = Array.from(new Set(calendars.map((calendar) => calendar.evg_stream).filter(Boolean)));
  const channelNames = Array.from(new Set(calendars.map((calendar) => calendar.channel_name).filter(Boolean)));
  const calendarSql = Prisma.join(calendars.map((calendar) => Prisma.sql`
    SELECT ${calendar.id} AS calendar_id, ${calendar.code} AS code, ${calendar.learn_number} AS learn_number,
           ${calendar.start_time} AS start_time, ${calendar.end_time} AS end_time,
           ${calendar.evg_stream || ''} AS evg_stream, ${calendar.channel_name || ''} AS channel_name
  `), ' UNION ALL ');
  const callbacks = await client.$queryRaw<Callback[]>(Prisma.sql`
    WITH selected_calendars AS (${calendarSql}), selected_callbacks AS (
      SELECT channel_id, channel_name, live_session_id, MIN(start_on) AS start_on, MAX(end_on) AS end_on
      FROM evg_callbacks
      WHERE channel_id IN (${Prisma.join(channelIds.length ? channelIds : [null])})
         OR channel_name IN (${Prisma.join(channelNames.length ? channelNames : [null])})
      GROUP BY channel_id, channel_name, live_session_id,
        CASE WHEN live_session_id IS NULL OR live_session_id = '' THEN start_on ELSE NULL END,
        CASE WHEN live_session_id IS NULL OR live_session_id = '' THEN end_on ELSE NULL END
    ), matched_callbacks AS (
      SELECT c.calendar_id, c.start_time, c.end_time, callback.live_session_id, callback.start_on, callback.end_on
      FROM selected_calendars c JOIN selected_callbacks callback ON callback.channel_id = c.evg_stream
      WHERE c.evg_stream <> ''
      UNION ALL
      SELECT c.calendar_id, c.start_time, c.end_time, callback.live_session_id, callback.start_on, callback.end_on
      FROM selected_calendars c JOIN selected_callbacks callback ON callback.channel_name = c.channel_name
      WHERE c.channel_name <> ''
    )
    SELECT c.calendar_id, callback.live_session_id,
           MIN(callback.start_on) AS start_on, MAX(callback.end_on) AS end_on
    FROM matched_callbacks callback JOIN selected_calendars c ON c.calendar_id = callback.calendar_id
    WHERE callback.start_on IS NOT NULL OR callback.end_on IS NOT NULL
    GROUP BY c.calendar_id, callback.live_session_id, c.start_time, c.end_time,
      CASE WHEN callback.live_session_id IS NULL OR callback.live_session_id = '' THEN callback.start_on ELSE NULL END,
      CASE WHEN callback.live_session_id IS NULL OR callback.live_session_id = '' THEN callback.end_on ELSE NULL END
    HAVING (MIN(callback.start_on) IS NULL OR MIN(callback.start_on) < c.end_time)
       AND (MAX(callback.end_on) IS NULL OR MAX(callback.end_on) > c.start_time)
  `);
  // Calendar timestamps và webhook times được đọc theo các thành phần UTC của DB.
  const windows = buildReportWindows(calendars, callbacks);
  const windowSql = Prisma.join(windows.map((window) => Prisma.sql`
    SELECT ${window.key} AS window_id, ${window.calendar.id} AS calendar_id, ${window.calendar.code} AS code,
           ${window.calendar.learn_number} AS learn_number, ${window.from} AS start_time, ${window.to} AS end_time,
           ${(window.calendar.teacher || '').trim().toLowerCase()} AS teacher_username,
           ${(window.calendar.assistant_teacher || '').split(',').map((username) => username.trim().toLowerCase()).filter(Boolean).join(',')} AS assistant_usernames,
           ${buildCalendarRoomClassId(window.calendar.code, window.calendar.start_time, window.calendar.learn_number, 1).slice(0, -1)} AS class_prefix
  `), ' UNION ALL ');
  /* Logic cũ (đã tắt): tổng >= 2 status=2, không cần liên tiếp.
   * Giữ nguyên đoạn code để có thể khôi phục khi cần; chỉ chạy một trong hai
   * truy vấn counts. Khi đổi lại, cập nhật cả mô tả trên bảng / Excel và test.
  const earliestActivity = new Date(Math.min(...windows.map((window) => window.from.getTime())));
  const latestActivity = new Date(Math.max(...windows.map((window) => window.to.getTime())));
  const counts = await client.$queryRaw<RoomCount[]>(Prisma.sql`
    WITH report_windows AS (${windowSql}), ranked_assignments AS (
      SELECT history.calendar_id, history.user_id, history.new_room_id,
             ROW_NUMBER() OVER (PARTITION BY history.calendar_id, history.user_id ORDER BY history.created_at DESC, history.id DESC) AS rank_number
      FROM classroom_assignment_history history WHERE history.calendar_id IN (${Prisma.join(calendars.map((calendar) => calendar.id))})
    ), enrollments AS (
      SELECT w.window_id, w.calendar_id, w.code, w.learn_number, w.start_time, w.end_time,
             student.id AS user_id, student.username, student.student_hmid,
             COALESCE(assigned.new_room_id,
               CASE WHEN student.room_id > 0 AND student.class_id = CONCAT(w.class_prefix, student.room_id) THEN student.room_id ELSE NULL END) AS room_id
      FROM report_windows w
      JOIN users student ON student.code = w.code AND student.learn_number = w.learn_number
      LEFT JOIN teacher_profiles staff ON LOWER(TRIM(staff.username)) = LOWER(TRIM(student.username))
        OR (NULLIF(TRIM(student.student_hmid), '') IS NOT NULL AND TRIM(staff.student_hmid) = TRIM(student.student_hmid))
      LEFT JOIN ranked_assignments assigned ON assigned.calendar_id = w.calendar_id AND assigned.user_id = student.id AND assigned.rank_number = 1
      WHERE staff.id IS NULL
        AND LOWER(TRIM(student.username)) <> w.teacher_username
        AND FIND_IN_SET(LOWER(TRIM(student.username)), w.assistant_usernames) = 0
    ), window_activity AS (
      SELECT w.window_id, LOWER(TRIM(activity.username)) AS username,
             TRIM(SUBSTRING_INDEX(activity.name, ' - ', 1)) AS student_hmid, COUNT(*) AS heartbeat_count
      FROM report_windows w
      JOIN users_logs activity ON activity.code = w.code AND activity.learn_number = w.learn_number
        AND activity.created_at >= w.start_time AND activity.created_at < w.end_time AND activity.status = 2
      WHERE activity.created_at >= ${earliestActivity} AND activity.created_at < ${latestActivity}
        AND activity.code IN (${Prisma.join(Array.from(new Set(calendars.map((calendar) => calendar.code))))})
      GROUP BY w.window_id, LOWER(TRIM(activity.username)), TRIM(SUBSTRING_INDEX(activity.name, ' - ', 1))
    ), matched_activity AS (
      SELECT enrolled.window_id, enrolled.user_id, activity.username, activity.student_hmid, activity.heartbeat_count
      FROM enrollments enrolled JOIN window_activity activity
        ON activity.window_id = enrolled.window_id AND activity.username = LOWER(TRIM(enrolled.username))
      UNION
      SELECT enrolled.window_id, enrolled.user_id, activity.username, activity.student_hmid, activity.heartbeat_count
      FROM enrollments enrolled JOIN window_activity activity
        ON activity.window_id = enrolled.window_id AND activity.student_hmid = enrolled.student_hmid
      WHERE enrolled.student_hmid IS NOT NULL AND enrolled.student_hmid <> ''
    ), student_activity AS (
      SELECT enrolled.window_id, enrolled.user_id, enrolled.room_id,
             COALESCE(SUM(activity.heartbeat_count), 0) AS heartbeat_count
      FROM enrollments enrolled
      LEFT JOIN matched_activity activity ON activity.window_id = enrolled.window_id AND activity.user_id = enrolled.user_id
      GROUP BY enrolled.window_id, enrolled.user_id, enrolled.room_id
    )
    SELECT window_id, room_id, COUNT(*) AS added_students,
           SUM(CASE WHEN heartbeat_count >= 2 THEN 1 ELSE 0 END) AS attended_students
    FROM student_activity GROUP BY window_id, room_id
  `);
  */
  // Đọc roster riêng: không nhân số dòng enrollment với toàn bộ log để UNION/LAG.
  const candidates = await client.$queryRaw<ReportEnrollment[]>(Prisma.sql`
    WITH report_windows AS (${windowSql}), ranked_assignments AS (
      SELECT history.calendar_id, history.user_id, history.new_room_id,
             ROW_NUMBER() OVER (PARTITION BY history.calendar_id, history.user_id ORDER BY history.created_at DESC, history.id DESC) AS rank_number
      FROM classroom_assignment_history history WHERE history.calendar_id IN (${Prisma.join(calendars.map((calendar) => calendar.id))})
    ), enrollments AS (
      SELECT w.window_id, w.calendar_id, w.code, w.learn_number, w.start_time, w.end_time,
             student.id AS user_id, student.username, student.student_hmid,
             COALESCE(assigned.new_room_id,
               CASE WHEN student.room_id > 0 AND student.class_id = CONCAT(w.class_prefix, student.room_id) THEN student.room_id ELSE NULL END) AS room_id
      FROM report_windows w
      JOIN users student ON student.code = w.code AND student.learn_number = w.learn_number
      LEFT JOIN ranked_assignments assigned ON assigned.calendar_id = w.calendar_id AND assigned.user_id = student.id AND assigned.rank_number = 1
      WHERE LOWER(TRIM(student.username)) <> w.teacher_username
        AND FIND_IN_SET(LOWER(TRIM(student.username)), w.assistant_usernames) = 0
    ) SELECT window_id, user_id, username, student_hmid, room_id FROM enrollments
  `);
  // Không JOIN OR + LOWER/TRIM với từng enrollment: đọc danh mục nhân sự một lần
  // rồi tra cứu bằng Set, vẫn loại cả username và HMID, kể cả profile vô hiệu hóa.
  const staff = candidates.length ? await client.$queryRaw<Array<{ username: string; student_hmid: string | null }>>(Prisma.sql`
    SELECT username, student_hmid FROM teacher_profiles
  `) : [];
  const normalizeStaff = (value: string | null) => (value || '').trim().toLowerCase();
  const staffUsernames = new Set(staff.map((profile) => normalizeStaff(profile.username)));
  const staffHmids = new Set(staff.map((profile) => normalizeStaff(profile.student_hmid)).filter(Boolean));
  const enrollments = candidates.filter((student) => !staffUsernames.has(normalizeStaff(student.username))
    && !staffHmids.has(normalizeStaff(student.student_hmid)));
  const counts: RoomCount[] = [];
  const enrolledKeys = new Set(enrollments.map((student) => student.window_id));
  const activeWindows = windows.filter((window) => enrolledKeys.has(window.key) && window.from < window.to);
  const identity = (code: string, learnNumber: number) => JSON.stringify([code.toLowerCase(), learnNumber]);
  for (const group of groupReportWindows(activeWindows)) {
    const keys = new Set(group.windows.map((window) => window.key));
    const roster = enrollments.filter((student) => keys.has(student.window_id));
    const byProgram = new Map<string, ReportWindow[]>();
    for (const window of group.windows) {
      const key = identity(window.calendar.code, window.calendar.learn_number);
      const matches = byProgram.get(key);
      if (matches) matches.push(window);
      else byProgram.set(key, [window]);
    }
    const programs = [...byProgram.values()].map(([window]) => Prisma.sql`(${window.calendar.code}, ${window.calendar.learn_number})`);
    const counter = createAttendanceCounter(roster);
    // Quét chung cho các chương trình trùng giờ; chia theo giờ để giới hạn
    // bộ nhớ mà không đọc lặp dải thời gian. Giữ chuỗi status qua các phần đọc.
    for (let from = group.from.getTime(); from < group.to.getTime(); from += 3_600_000) {
      const to = Math.min(from + 3_600_000, group.to.getTime());
      const logs = await client.$queryRaw<LogActivity[]>(Prisma.sql`
        SELECT id AS activity_id, created_at, status, username, code, learn_number,
               TRIM(SUBSTRING_INDEX(name, ' - ', 1)) AS student_hmid
        FROM users_logs
        WHERE created_at >= ${new Date(from)} AND created_at < ${new Date(to)}
          AND (code, learn_number) IN (${Prisma.join(programs)})
      `);
      const activities: ReportActivity[] = [];
      for (const activity of logs) {
        for (const window of byProgram.get(identity(activity.code, Number(activity.learn_number))) || []) {
          // Vẫn xét đúng biên giờ của từng phiên, không ghép chuỗi qua phiên khác.
          if (activity.created_at >= window.from && activity.created_at < window.to) {
            activities.push({ ...activity, window_id: window.key });
          }
        }
      }
      counter.add(activities);
    }
    counts.push(...counter.result());
  }
  // Buổi chưa bắt đầu/không có cửa sổ hợp lệ vẫn phải có tổng enrollment.
  const activeKeys = new Set(activeWindows.map((window) => window.key));
  counts.push(...countConsecutiveAttendance(enrollments.filter((student) => !activeKeys.has(student.window_id)), []));
  return groupByRoom ? assembleRoomReport(windows, counts) : assembleProgramReport(windows, counts);
};

type CalendarLister = (query: any) => Promise<{ total: number; data: ReportCalendar[] }>;
export const getCalendarRoomReport = async (query: any, listCalendars: CalendarLister, exportAll = false, client = prisma) => {
  if (query.group_by !== undefined && !['program', 'room'].includes(query.group_by)) throw new ApiError('Cách hiển thị báo cáo không hợp lệ', 400);
  const groupByRoom = query.group_by === 'room' || query.room_id !== undefined;
  const roomId = query.room_id === undefined ? undefined : query.room_id === 'unassigned' ? null : Number(query.room_id);
  if (roomId !== undefined && roomId !== null && (!Number.isSafeInteger(roomId) || roomId <= 0)) throw new ApiError('Room phải là số nguyên dương', 400);
  const page = exportAll ? 1 : Number(query.page ?? 1);
  const limit = exportAll ? 100 : 20;
  if (!Number.isSafeInteger(page) || page < 1) throw new ApiError('Trang báo cáo không hợp lệ', 400);
  const first = await listCalendars({ ...query, page, limit });
  if (exportAll && first.total > 2000) throw new ApiError('Báo cáo Excel tối đa 2.000 buổi. Vui lòng thu hẹp bộ lọc.', 400);
  const rows: CalendarRoomReportRow[] = [];
  rows.push(...await queryRoomReport(first.data, client, groupByRoom));
  if (exportAll) {
    for (let nextPage = 2; (nextPage - 1) * limit < first.total; nextPage++) {
      const next = await listCalendars({ ...query, page: nextPage, limit });
      rows.push(...await queryRoomReport(next.data, client, groupByRoom));
    }
  }
  return {
    group_by: groupByRoom ? 'room' as const : 'program' as const,
    total_schedules: first.total, page, limit,
    rooms: Array.from(new Set(rows.map((row) => row.room_id))).sort((left, right) => (left || 0) - (right || 0)),
    data: roomId === undefined ? rows : rows.filter((row) => row.room_id === roomId),
  };
};

export const buildCalendarRoomReportWorkbook = (rows: CalendarRoomReportRow[], groupBy: 'program' | 'room' = 'program') => {
  const liveDate = (value: string) => value.slice(0, 10).split('-').reverse().join('/');
  const time = (value: string) => value.slice(11, 16);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows.map((row) => ({
    'Hệ thống': row.system_type, 'Chương trình': row.code,
    'Buổi học': row.learn_number, 'Tên bài': row.lesson_name, 'Giáo viên': row.teacher,
    ...(groupBy === 'room' ? { 'Room': row.room_id ?? 'Chưa chia' } : {}),
    'Ngày live': liveDate(row.scheduled_start_time),
    'Khung giờ': `${time(row.scheduled_start_time)} - ${time(row.scheduled_end_time)}`,
    'HS học': row.attended_students, 'Tổng HS được thêm': row.added_students,
    'Tỷ lệ học (%)': row.added_students ? Math.round(row.attended_students * 1000 / row.added_students) / 10 : 0,
    'Trạng thái buổi': row.lesson_status === 1 ? 'Nghỉ/Hủy' : 'Bình thường',
  })), { header: ['Hệ thống', 'Chương trình', 'Buổi học', 'Tên bài', 'Giáo viên', ...(groupBy === 'room' ? ['Room'] : []), 'Ngày live', 'Khung giờ', 'HS học', 'Tổng HS được thêm', 'Tỷ lệ học (%)', 'Trạng thái buổi'] });
  const columnCount = groupBy === 'room' ? 12 : 11;
  for (let index = 0; index < rows.length; index++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: index + 1, c: columnCount - 2 })];
    cell.z = 'General';
  }
  const widths = [12, 26, 9, 50, 26, ...(groupBy === 'room' ? [10] : []), 14, 18, 10, 13, 12, 18];
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  sheet['!rows'] = [{ hpt: 34 }];
  for (let column = 0; column < columnCount; column++) {
    sheet[XLSX.utils.encode_cell({ r: 0, c: column })].s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: '0C343D' } },
      alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
      border: { bottom: { style: 'thin', color: { rgb: '65B98B' } } },
    };
  }
  XLSX.utils.book_append_sheet(workbook, sheet, 'Bao cao lop hoc');
  const guide = XLSX.utils.aoa_to_sheet([
    ['Quy ước', 'Diễn giải'],
    ['Ngày live / Khung giờ', 'Ngày và giờ bắt đầu - kết thúc theo lịch học, giữ nguyên giờ Việt Nam trong dữ liệu lịch.'],
    ['HS học', 'Có ít nhất 2 ghi nhận chuyên cần liên tiếp, mỗi 5 phút (~10 phút học); join lại sẽ ngắt chuỗi. Nếu thiếu giờ thực tế, dùng khung giờ lịch.'],
    ['Tổng HS được thêm', 'Danh sách enrollment hiện có của chương trình + buổi, loại giáo viên/trợ giảng.'],
    ['Phạm vi', groupBy === 'room' ? 'Hiển thị từng room, áp dụng bộ lọc room đã chọn. Room theo lịch sử chia của đúng buổi.' : 'Gộp tất cả room và học sinh chưa chia room của chương trình trong buổi học.'],
    ['Tổng hợp', groupBy === 'room' ? 'Một dòng cho mỗi room trong một phiên học. Số HS có thể lặp giữa các phiên học.' : 'Một dòng cho mỗi chương trình trong một phiên học. Số HS có thể lặp giữa các phiên học.'],
  ]);
  guide['!cols'] = [{ wch: 24 }, { wch: 100 }];
  guide['!rows'] = [{ hpt: 28 }];
  for (const address of ['A1', 'B1']) {
    guide[address].s = sheet['A1'].s;
  }
  XLSX.utils.book_append_sheet(workbook, guide, 'Huong dan');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
