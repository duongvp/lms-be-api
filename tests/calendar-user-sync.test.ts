import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCalendarClassId,
  ensureCalendarTeachingUsers,
  excelDateSerialFromCalendarDate,
  resolveCalendarTeacherProfile,
  syncCalendarTeachingUsers,
} from '../src/modules/livestream/calendar-user-sync.service';

test('tính Excel Date Serial giống VALUE(D) cho ngày 13/08/2026', () => {
  assert.equal(
    excelDateSerialFromCalendarDate('2026-08-13T20:00:00.000Z'),
    46247
  );
});

test('giờ học không làm thay đổi Excel Date Serial của cùng một ngày', () => {
  assert.equal(
    excelDateSerialFromCalendarDate('2026-08-13T07:00:00.000Z'),
    excelDateSerialFromCalendarDate('2026-08-13T22:30:00.000Z')
  );
});

test('tạo class_id đúng công thức N & VALUE(D) & O & "1"', () => {
  assert.equal(
    buildCalendarClassId(
      'tongondinhluonghsav2027',
      '2026-08-13T20:00:00.000Z',
      9
    ),
    'tongondinhluonghsav20274624791'
  );
});

test('ưu tiên username khi nhiều giáo viên có cùng display_name', async () => {
  const profile = await resolveCalendarTeacherProfile({
    teacher_profiles: {
      findMany: async () => [
        { username: 'co-dung-1', display_name: 'Cô Dung' },
        { username: 'co-dung-2', display_name: 'Cô Dung' },
      ],
    },
  }, 'co-dung-2');

  assert.equal(profile?.username, 'co-dung-2');
});

test('tạo lịch upsert giáo viên và toàn bộ trợ giảng, không tạo khóa khác nhau', async () => {
  const upserts: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async ({ where }: any) => where.can_view_stream_key === 1
        ? [{ username: 'gv01', display_name: 'Giáo viên 01' }]
        : (where.username.in as string[]).map((username) => ({
            username,
            display_name: username.toUpperCase(),
          })),
    },
    users: {
      findFirst: async () => null,
      upsert: async (input: any) => { upserts.push(input); },
      deleteMany: async () => undefined,
    },
    $queryRaw: async () => [],
  };

  await syncCalendarTeachingUsers(client, null, {
    id: 10,
    code: 'tongondinhluonghsav2027',
    learn_number: 9,
    start_time: '2026-08-13T20:00:00.000Z',
    teacher: 'Giáo viên 01',
    assistant_teacher: 'tg01,tg02',
    lesson_status: 0,
  });

  assert.deepEqual(
    upserts.map((item) => item.create.username),
    ['gv01', 'tg01', 'tg02']
  );
  assert.ok(upserts.every(
    (item) => item.create.class_id === 'tongondinhluonghsav20274624791'
      && item.create.room_id === 1
  ));
});

test('bulk chỉ bổ sung enrollment nhân sự còn thiếu, không sửa user đã tồn tại', async () => {
  const creates: any[] = [];
  const existingUsernames = new Set(['gv01']);
  const client = {
    teacher_profiles: {
      findMany: async ({ where }: any) => where.can_view_stream_key === 1
        ? [{ username: 'gv01', display_name: 'Giáo viên 01' }]
        : (where.username.in as string[]).map((username) => ({
            username,
            display_name: username.toUpperCase(),
          })),
    },
    users: {
      findFirst: async () => null,
      findUnique: async ({ where }: any) => (
        existingUsernames.has(where.username_code_learn_number.username)
          ? { id: 1 }
          : null
      ),
      create: async (input: any) => { creates.push(input); },
    },
  };

  const result = await ensureCalendarTeachingUsers(client, {
    code: 'tongondinhluonghsav2027',
    learn_number: 9,
    start_time: '2026-08-13T20:00:00.000Z',
    teacher: 'Giáo viên 01',
    assistant_teacher: 'tg01',
    lesson_status: 0,
  });

  assert.equal(result.created, 1);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].data.username, 'tg01');
  assert.equal(creates[0].data.name, 'Giáo viên');
  assert.equal(creates[0].data.room_id, 1);
  assert.equal(creates[0].data.class_id, 'tongondinhluonghsav20274624791');
});

test('quét user lưu name của trợ giảng bằng student_hmid và nhãn Giáo viên', async () => {
  const creates: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async ({ where }: any) => where.can_view_stream_key === 1
        ? [{ username: 'gv01', display_name: 'Giáo viên 01' }]
        : [{ username: 'tg01', display_name: 'Trợ giảng 01' }],
    },
    users: {
      findUnique: async () => null,
      findFirst: async ({ where }: any) => (
        where.username === 'tg01'
          ? { student_hmid: 'HM12345' }
          : { student_hmid: 'HM-GV01' }
      ),
      create: async (input: any) => { creates.push(input); },
    },
  };

  const result = await ensureCalendarTeachingUsers(client, {
    code: 'tongondinhluonghsav2027',
    learn_number: 9,
    start_time: '2026-08-13T20:00:00.000Z',
    teacher: 'Giáo viên 01',
    assistant_teacher: 'tg01',
    lesson_status: 0,
  });

  assert.equal(result.created, 2);
  assert.equal(creates[0].data.username, 'gv01');
  assert.equal(creates[0].data.name, 'Giáo viên 01');
  assert.equal(creates[1].data.username, 'tg01');
  assert.equal(creates[1].data.name, 'HM12345 - Giáo viên');
  assert.equal(creates[1].data.student_hmid, 'HM12345');
});

test('đổi ngày cập nhật class_id trên đúng user hiện tại, không tạo identity mới', async () => {
  const upserts: any[] = [];
  const updates: any[] = [];
  const deletes: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async () => [{ username: 'gv01', display_name: 'Giáo viên 01' }],
    },
    users: {
      findFirst: async () => null,
      upsert: async (input: any) => { upserts.push(input); },
      updateMany: async (input: any) => { updates.push(input); },
      deleteMany: async (input: any) => { deletes.push(input); },
    },
    $queryRaw: async () => [],
  };
  const base = {
    id: 10,
    code: 'tongondinhluonghsav2027',
    learn_number: 9,
    teacher: 'Giáo viên 01',
    assistant_teacher: null,
    lesson_status: 0,
  };

  await syncCalendarTeachingUsers(
    client,
    { ...base, start_time: '2026-08-12T20:00:00.000Z' },
    { ...base, start_time: '2026-08-13T20:00:00.000Z' }
  );

  assert.equal(upserts.length, 0);
  assert.equal(
    updates[0].where.code,
    'tongondinhluonghsav2027'
  );
  assert.equal(updates[0].data.class_id, 'tongondinhluonghsav20274624791');
  assert.equal(deletes.length, 0);
});

test('tên giáo viên legacy trùng nhiều profile không chặn đổi ngày lịch', async () => {
  const updates: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async () => [
        { username: 'co-dung-1', display_name: 'Cô Dung' },
        { username: 'co-dung-2', display_name: 'Cô Dung' },
      ],
    },
    users: {
      updateMany: async (input: any) => { updates.push(input); },
      upsert: async () => undefined,
      deleteMany: async () => undefined,
    },
    $queryRaw: async () => [],
  };
  const base = {
    id: 10,
    code: 'sinhhoc-7-2027',
    learn_number: 1,
    teacher: 'Cô Dung',
    assistant_teacher: null,
    lesson_status: 0,
  };

  await syncCalendarTeachingUsers(
    client,
    { ...base, start_time: '2026-08-12T20:00:00.000Z' },
    { ...base, start_time: '2026-08-13T20:00:00.000Z' }
  );

  assert.equal(updates.length, 1);
  assert.equal(updates[0].data.class_id, 'sinhhoc-7-20274624711');
});

test('nghỉ học thu hồi user room_id = 1 khi không còn lịch hoạt động cùng bài', async () => {
  const deletes: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async () => [{ username: 'gv01', display_name: 'Giáo viên 01' }],
    },
    users: {
      upsert: async () => undefined,
      updateMany: async () => undefined,
      deleteMany: async (input: any) => { deletes.push(input); },
    },
    $queryRaw: async () => [],
  };
  const current = {
    id: 10,
    code: 'tongondinhluonghsav2027',
    learn_number: 9,
    start_time: '2026-08-13T20:00:00.000Z',
    teacher: 'gv01',
    assistant_teacher: null,
    lesson_status: 0,
  };

  await syncCalendarTeachingUsers(client, current, {
    ...current,
    lesson_status: 1,
  });

  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].where.username, 'gv01');
  assert.equal(deletes[0].where.room_id, 1);
  assert.equal(deletes[0].where.islearn, 0);
});

test('đổi giáo viên upsert người mới và thu hồi người cũ nếu không còn lịch khác', async () => {
  const upserts: any[] = [];
  const deletes: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async ({ where }: any) => {
        const identifier = where.OR[0].username;
        return identifier === 'Giáo viên A'
          ? [{ username: 'gv-a', display_name: 'Giáo viên A' }]
          : [{ username: 'gv-b', display_name: 'Giáo viên B' }];
      },
    },
    users: {
      findFirst: async () => null,
      upsert: async (input: any) => { upserts.push(input); },
      deleteMany: async (input: any) => { deletes.push(input); },
    },
    $queryRaw: async () => [],
  };
  const base = {
    id: 10,
    code: 'tongondinhluonghsav2027',
    learn_number: 9,
    start_time: '2026-08-13T20:00:00.000Z',
    assistant_teacher: null,
    lesson_status: 0,
  };

  await syncCalendarTeachingUsers(
    client,
    { ...base, teacher: 'Giáo viên A' },
    { ...base, teacher: 'Giáo viên B' }
  );

  assert.equal(upserts[0].create.username, 'gv-b');
  assert.equal(deletes[0].where.username, 'gv-a');
  assert.equal(deletes[0].where.room_id, 1);
  assert.equal(deletes[0].where.islearn, 0);
});
