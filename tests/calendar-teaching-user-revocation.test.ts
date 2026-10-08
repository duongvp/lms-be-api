import assert from 'node:assert/strict';
import test from 'node:test';
import prisma from '../src/lib/prisma';
import {
  buildCalendarClassId,
  ensureCalendarScanTeachingUsers,
  syncCalendarTeachingUsers,
} from '../src/modules/livestream/calendar-user-sync.service';
import { updateSchedule, updateBulk, backfillMissingCalendarTeachingUsers } from '../src/modules/livestream/livestream.service';
import { runCalendarTeachingUserSync } from '../src/modules/livestream/calendar-teaching-user-sync.worker';

const calendar = (overrides: any = {}) => ({
  id: 10, key: 'live-10', code: 'toan-8-2027', learn_number: 24,
  start_time: new Date('2099-09-16T18:00:00.000Z'),
  end_time: new Date('2099-09-16T19:00:00.000Z'),
  teacher: 'gv01', assistant_teacher: 'tg01,tg02', lesson_status: 0,
  ...overrides,
});
const classId = (row: any) => buildCalendarClassId(row.code, row.start_time, row.learn_number);

// In-memory persistence checks the same class_id predicate as the real writes.
const fixture = (calendars = [calendar()]) => {
  const profiles = [
    { username: 'gv01', display_name: 'Giáo viên 01', can_view_stream_key: 1, status: 1 },
    { username: 'tg01', display_name: 'Trợ giảng 01', can_view_stream_key: 0, status: 1 },
    { username: 'tg02', display_name: 'Trợ giảng 02', can_view_stream_key: 0, status: 1 },
  ];
  const users = ['gv01', 'tg01', 'tg02', 'student01'].map((username, index) => ({
    id: index + 1, username, code: calendars[0].code, learn_number: calendars[0].learn_number,
    class_id: classId(calendars[0]), room_id: 1, islearn: 0,
    name: username, student_hmid: `HM-${username}`,
    created_at: new Date('2099-09-16T00:00:00.000Z'),
    userRoles: username === 'tg01' ? [{ roleId: 2 }] : [],
  }));
  const writes: any[] = [];
  const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]: any) => {
    if (key === 'OR') return value.some((entry: any) => matches(row, entry));
    if (key === 'NOT') return !matches(row, value);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('notIn' in value) return !value.notIn.includes(row[key]);
      if ('not' in value) return row[key] !== value.not;
      return true;
    }
    return value === undefined || row[key] === value;
  });
  const query = async (sql: any, ...values: any[]) => {
    const text = Array.isArray(sql) ? sql.join('?') : sql.sql;
    const params = Array.isArray(sql) ? values : sql.values;
    if (text.includes('SELECT * FROM calendar') && text.includes('FOR UPDATE')) {
      return calendars.filter((row) => params.includes(row.id)).map((row) => ({ ...row }));
    }
    if (text.includes('SELECT teacher, assistant_teacher, start_time')) {
      return calendars.filter((row) => row.code === params[0] && row.learn_number === params[1]
        && row.lesson_status !== 1 && row.id !== params[2]).map((row) => ({ ...row }));
    }
    if (text.includes('SELECT id, assistant_teacher, session_id')) {
      return calendars.filter((row) => params.includes(row.id)).map((row) => ({ ...row }));
    }
    if (text.includes('SELECT') && text.includes('FROM calendar') && text.includes('LIMIT 1')) {
      return calendars.filter((row) => row.id === params[0]).map((row) => ({ ...row }));
    }
    return [];
  };
  const client: any = {
    teacher_profiles: { findMany: async ({ where }: any) => profiles.filter((row) => matches(row, where)) },
    users: {
      findFirst: async ({ where }: any) => users.find((row) => matches(row, where)) || null,
      findMany: async ({ where }: any) => users.filter((row) => matches(row, where)).map((row) => ({ ...row })),
      update: async ({ where, data }: any) => {
        Object.assign(users.find((row) => row.id === where.id)!, data);
      },
      updateMany: async ({ where, data }: any) => {
        writes.push({ where, data });
        const selected = users.filter((row) => matches(row, where));
        selected.forEach((row) => Object.assign(row, data));
        return { count: selected.length };
      },
      create: async ({ data }: any) => {
        const row = { ...data, id: users.length + 1, userRoles: [] };
        users.push(row);
        return row;
      },
    },
    calendar: {
      findUnique: async ({ where }: any) => {
        const row = calendars.find((row) => row.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: any) => {
        // Selected rows and conflicts are separate queries.
        if (!where?.id?.in) return [];
        return calendars.filter((row) => where.id.in.includes(row.id)).map((row) => ({ ...row }));
      },
      update: async ({ where, data }: any) => {
        const row = calendars.find((row) => row.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      },
    },
    $queryRaw: query,
    $executeRawUnsafe: async () => 0,
    $executeRaw: async (sql: any, ...values: any[]) => {
      const text = Array.isArray(sql) ? sql.join('?') : sql.sql;
      if (text.includes('SET assistant_teacher')) {
        calendars.find((row) => row.id === values[1])!.assistant_teacher = values[0];
      }
      return 1;
    },
  };
  return { client, users, profiles, writes, calendars };
};

for (const empty of [null, '', []]) {
  test(`bỏ hết trợ giảng (${JSON.stringify(empty)}) thu hồi đúng lớp, giữ giáo viên/học viên/RBAC`, async () => {
    const f = fixture();
    const before = { ...f.calendars[0] };
    const after = { ...before, assistant_teacher: empty };
    f.calendars[0] = after;
    await syncCalendarTeachingUsers(f.client, before, after);
    assert.equal(f.users.find((row) => row.username === 'tg01')!.class_id, null);
    assert.equal(f.users.find((row) => row.username === 'tg02')!.class_id, null);
    assert.equal(f.users.find((row) => row.username === 'gv01')!.class_id, classId(before));
    assert.equal(f.users.find((row) => row.username === 'student01')!.class_id, classId(before));
    assert.deepEqual(f.users.find((row) => row.username === 'tg01')!.userRoles, [{ roleId: 2 }]);
    assert.equal(f.users.length, 4);
  });
}

test('bỏ một trợ giảng chỉ thu hồi người bị bỏ', async () => {
  const f = fixture();
  const before = { ...f.calendars[0] };
  f.calendars[0].assistant_teacher = 'tg02';
  await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
  assert.equal(f.users[1].class_id, null);
  assert.equal(f.users[2].class_id, classId(before));
});

test('lịch khác ngày cùng bài không giữ quyền trợ giảng của lớp đã bỏ', async () => {
  const f = fixture([calendar(), calendar({ id: 11, start_time: new Date('2099-09-17T18:00:00.000Z') })]);
  const before = { ...f.calendars[0] };
  f.calendars[0].assistant_teacher = null;
  await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
  assert.equal(f.users[1].class_id, null);
});

test('thu hồi lớp cũ không xóa class_id đã chuyển sang lớp khác', async () => {
  const f = fixture();
  const before = { ...f.calendars[0] };
  const otherClassId = classId(calendar({ start_time: new Date('2099-09-17T18:00:00.000Z') }));
  f.users[1].class_id = otherClassId;
  f.calendars[0].assistant_teacher = null;
  await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
  assert.equal(f.users[1].class_id, otherClassId);
});

test('thu hồi trợ giảng kể cả profile đã bị xóa', async () => {
  const f = fixture();
  const before = { ...f.calendars[0] };
  f.profiles.splice(1, 1);
  f.calendars[0].assistant_teacher = null;
  await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
  assert.equal(f.users[1].class_id, null);
});

for (const cancelled of [false, true]) {
  test(`quét/cron dọn trợ giảng thừa${cancelled ? ' trên lịch hủy' : ''} và không cấp lại khi quét tiếp`, async () => {
    const f = fixture();
    const before = { ...f.calendars[0] };
    f.calendars[0].assistant_teacher = null;
    f.calendars[0].lesson_status = cancelled ? 1 : 0;
    await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
    await ensureCalendarScanTeachingUsers(f.client, f.calendars[0]);
    assert.equal(f.users[1].class_id, null);
    assert.equal(f.users[2].class_id, null);
    assert.equal(f.users[3].class_id, classId(f.calendars[0]));
    await ensureCalendarScanTeachingUsers(f.client, f.calendars[0]);
    assert.equal(f.users[1].class_id, null);
    assert.equal(f.users.length, cancelled ? 4 : 5);
    if (!cancelled) assert.equal(f.users[4].username, 'loandtt3@hocmai.vn');
  });
}

test('đổi ngày chỉ chuyển nhân sự được gán, giữ nguyên học viên và user bổ sung khác', async () => {
  const f = fixture([calendar({ assistant_teacher: 'tg02' })]);
  const before = { ...f.calendars[0] };
  f.calendars[0].start_time = new Date('2099-09-17T18:00:00.000Z');
  await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
  assert.equal(f.users[0].class_id, classId(f.calendars[0]));
  assert.equal(f.users[1].class_id, classId(before));
  assert.equal(f.users[2].class_id, classId(f.calendars[0]));
  assert.equal(f.users[3].class_id, classId(before));
});

for (const mode of ['quick', 'common', 'separate', 'omitted']) {
  test(`luồng lưu lịch ${mode} xử lý trợ giảng rỗng/không gửi trường`, async (t) => {
    const f = fixture();
    t.mock.method(prisma, '$transaction', async (operation: any) => operation(f.client));
    t.mock.method(prisma, '$queryRaw', f.client.$queryRaw);
    const originalCalendar = prisma.calendar;
    (prisma as any).calendar = f.client.calendar;
    t.after(() => { (prisma as any).calendar = originalCalendar; });
    if (mode === 'quick' || mode === 'omitted') {
      await updateSchedule(10, mode === 'quick' ? { assistant_teacher: [] } : { lesson_name: 'Tên mới' }, 'current');
    } else {
      await updateBulk({
        ids: [10], config_mode: mode,
        update_data: mode === 'common' ? { assistant_teacher: null } : [{ id: 10, assistant_teacher: '' }],
      });
    }
    assert.equal(f.calendars[0].assistant_teacher, mode === 'omitted' ? 'tg01,tg02' : null);
    assert.equal(f.users[1].class_id, mode === 'omitted' ? classId(f.calendars[0]) : null);
    assert.equal(f.users[2].class_id, mode === 'omitted' ? classId(f.calendars[0]) : null);
    assert.equal(f.users[3].class_id, classId(f.calendars[0]));
  });
}


test('cron thực tế quét cả lịch đã bỏ trợ giảng và lịch hủy để thu hồi user thừa', async (t) => {
  const f = fixture([calendar(), calendar({ id: 11, lesson_status: 1 })]);
  f.profiles.push({ username: 'loandtt3@hocmai.vn', display_name: 'Đào Thị Thúy Loan', can_view_stream_key: 0, status: 1 });
  const before = { ...f.calendars[0] };
  f.calendars[0].assistant_teacher = null;
  await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
  t.mock.method(prisma, '$transaction', async (operation: any) => operation(f.client));
  t.mock.method(prisma, '$executeRaw', async () => 1);
  t.mock.method(prisma, '$queryRaw', async (sql: any, ...values: any[]) => {
    const text = Array.isArray(sql) ? sql.join('?') : sql.sql;
    if (text.includes('calendar_teaching_user_sync_runs')) return [{ id: 1n }];
    return f.client.$queryRaw(sql, ...values);
  });
  const originalCalendar = prisma.calendar;
  (prisma as any).calendar = {
    findMany: async ({ where }: any) => {
      assert.equal(where.OR, undefined, 'cron phải bao gồm lịch hủy');
      return f.calendars.map((row) => ({ id: row.id }));
    },
  };
  t.after(() => { (prisma as any).calendar = originalCalendar; });
  const result = await runCalendarTeachingUserSync(new Date('2099-09-15T20:00:00.000Z'));
  assert.equal(result.started, true);
  assert.equal((result as any).scanned, 2);
  assert.equal((result as any).failed, 0);
  assert.equal(f.users.find((row) => row.username === 'loandtt3@hocmai.vn')!.class_id, classId(f.calendars[0]));
  assert.equal(f.users[1].class_id, null);
  assert.equal(f.users[2].class_id, null);
  assert.equal(f.users[3].class_id, classId(f.calendars[0]));
});


test('quét dùng phân công mới nhất sau khi lấy khóa lịch, không dùng snapshot cũ để thêm lại trợ giảng', async (t) => {
  const f = fixture();
  const originalQuery = f.client.$queryRaw;
  let locked = false;
  f.client.$queryRaw = async (sql: any, ...values: any[]) => {
    const text = Array.isArray(sql) ? sql.join('?') : sql.sql;
    if (text.includes('SELECT * FROM calendar') && text.includes('FOR UPDATE')) {
      // Mô phỏng thao tác sửa hoàn tất trong lúc lượt quét chờ khóa.
      f.calendars[0].assistant_teacher = null;
      f.users[1].class_id = null as any;
      f.users[2].class_id = null as any;
      locked = true;
    }
    return originalQuery(sql, ...values);
  };
  t.mock.method(prisma, '$transaction', async (operation: any) => operation(f.client));
  const result = await backfillMissingCalendarTeachingUsers([10]);
  assert.equal(locked, true);
  assert.equal(result.failed, 0);
  assert.equal(f.users[1].class_id, null);
  assert.equal(f.users[2].class_id, null);
});


test('quét mặc định/cron bổ sung Loan ngoài phân công; sửa lịch không dọn nhầm tài khoản bổ sung', async () => {
  const f = fixture();
  await ensureCalendarScanTeachingUsers(f.client, f.calendars[0]);
  const support = f.users.find((row) => row.username === 'loandtt3@hocmai.vn')!;
  assert.equal(support.class_id, classId(f.calendars[0]));
  assert.equal(support.name, 'Giáo viên');
  const before = { ...f.calendars[0] };
  f.calendars[0].assistant_teacher = null;
  await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
  assert.equal(f.users[1].class_id, null);
  assert.equal(support.class_id, classId(f.calendars[0]));
  await ensureCalendarScanTeachingUsers(f.client, f.calendars[0]);
  assert.equal(f.users[1].class_id, null);
  assert.equal(support.class_id, classId(f.calendars[0]));
  assert.equal(f.users.filter((row) => row.username === 'loandtt3@hocmai.vn').length, 1);
});

test('danh sách bổ sung thủ công vẫn được giữ khi sửa lịch và quét mặc định tiếp theo', async () => {
  const f = fixture();
  await ensureCalendarScanTeachingUsers(f.client, f.calendars[0], [{ username: 'support-custom', role: 'assistant' }]);
  const support = f.users.find((row) => row.username === 'support-custom')!;
  const before = { ...f.calendars[0] };
  f.calendars[0].assistant_teacher = null;
  await syncCalendarTeachingUsers(f.client, before, f.calendars[0]);
  await ensureCalendarScanTeachingUsers(f.client, f.calendars[0]);
  assert.equal(support.class_id, classId(f.calendars[0]));
  assert.equal(support.name, 'Giáo viên');
  assert.equal(f.users[1].class_id, null);
});
