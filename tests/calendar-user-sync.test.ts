import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCalendarClassId,
  buildCalendarRoomClassId,
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

test('tạo class_id từng room theo đúng ngày của calendar được chọn', () => {
  assert.equal(
    buildCalendarRoomClassId('sinhhoc-7-2027', '2026-08-30T01:00:00.000Z', 1, 3),
    'sinhhoc-7-20274626413'
  );
  assert.equal(
    buildCalendarRoomClassId('sinhhoc-7-2027', '2026-08-31T01:00:00.000Z', 1, 3),
    'sinhhoc-7-20274626513'
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

test('tạo lịch thêm giáo viên và toàn bộ trợ giảng theo cùng class_id', async () => {
  const creates: any[] = [];
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
      findFirst: async ({ where }: any) => {
        if (where.learn_number !== undefined) return null;
        const hmidByUsername: Record<string, string> = {
          gv01: 'HM-GV01',
          tg01: 'HM-TG01',
          tg02: 'HM-TG02',
        };
        return { student_hmid: hmidByUsername[where.username] };
      },
      create: async (input: any) => { creates.push(input); },
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
    creates.map((item) => item.data.username),
    ['gv01', 'tg01', 'tg02']
  );
  assert.deepEqual(
    creates.map((item) => item.data.name),
    ['Giáo viên 01', 'HM-TG01 - Giáo viên', 'HM-TG02 - Giáo viên']
  );
  assert.ok(creates.every(
    (item) => item.data.class_id === 'tongondinhluonghsav20274624791'
      && item.data.room_id === 1
  ));
});

test('bulk tạo enrollment còn thiếu và cập nhật enrollment đã tồn tại', async () => {
  const creates: any[] = [];
  const updates: any[] = [];
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
      findFirst: async ({ where }: any) => where.learn_number !== undefined
        && existingUsernames.has(where.username)
        ? { id: 1, student_hmid: null, name: 'Giáo viên 01' }
        : null,
      create: async (input: any) => { creates.push(input); },
      update: async (input: any) => { updates.push(input); },
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
  assert.equal(result.updated, 1);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].data.username, 'tg01');
  assert.equal(creates[0].data.name, 'Giáo viên');
  assert.equal(creates[0].data.room_id, 1);
  assert.equal(creates[0].data.class_id, 'tongondinhluonghsav20274624791');
});

test('quét hai lịch khác ngày của cùng bài chỉ tạo một enrollment theo khóa 3 cột', async () => {
  const creates: any[] = [];
  const updates: any[] = [];
  let enrollmentExists = false;
  const client = {
    teacher_profiles: {
      findMany: async () => [{ username: 'gv01', display_name: 'Giáo viên 01' }],
    },
    users: {
      findFirst: async ({ where }: any) => where.learn_number !== undefined
        && enrollmentExists
        ? { id: 1, student_hmid: null, name: 'Giáo viên 01' }
        : null,
      create: async (input: any) => {
        enrollmentExists = true;
        creates.push(input);
      },
      update: async (input: any) => { updates.push(input); },
    },
  };
  const base = {
    code: 'sinhhoc-7-2027',
    learn_number: 1,
    teacher: 'Giáo viên 01',
    assistant_teacher: null,
    lesson_status: 0,
  };

  const first = await ensureCalendarTeachingUsers(client, {
    ...base,
    start_time: '2026-08-30T01:00:00.000Z',
  });
  const second = await ensureCalendarTeachingUsers(client, {
    ...base,
    start_time: '2026-08-31T01:00:00.000Z',
  });

  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(second.updated, 1);
  assert.equal(creates.length, 1);
  assert.equal(updates.length, 1);
  assert.equal(creates[0].data.class_id, 'sinhhoc-7-20274626411');
});

test('P2002 do tạo đồng thời sẽ đọc lại và cập nhật enrollment đã thắng race', async () => {
  const updates: any[] = [];
  let identityLookups = 0;
  const client = {
    teacher_profiles: {
      findMany: async () => [{ username: 'gv01', display_name: 'Giáo viên 01' }],
    },
    users: {
      findFirst: async ({ where }: any) => {
        if (where.learn_number === undefined) return null;
        identityLookups += 1;
        return identityLookups === 1 ? null : { id: 77 };
      },
      create: async () => {
        const error: any = new Error('Unique constraint failed');
        error.code = 'P2002';
        throw error;
      },
      update: async (input: any) => { updates.push(input); },
    },
  };

  const result = await ensureCalendarTeachingUsers(client, {
    code: 'sinhhoc-7-2027',
    learn_number: 1,
    start_time: '2026-08-30T01:00:00.000Z',
    teacher: 'Giáo viên 01',
    assistant_teacher: null,
    lesson_status: 0,
  });

  assert.equal(result.created, 0);
  assert.equal(result.updated, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, 77);
  assert.equal(updates[0].data.class_id, 'sinhhoc-7-20274626411');
});

test('quét user lưu name của trợ giảng theo quy ước student_hmid - Giáo viên', async () => {
  const creates: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async ({ where }: any) => where.can_view_stream_key === 1
        ? [{ username: 'gv01', display_name: 'Giáo viên 01' }]
        : [{ username: 'tg01', display_name: 'Trợ giảng 01' }],
    },
    users: {
      findFirst: async ({ where }: any) => {
        if (where.learn_number !== undefined) return null;
        return where.username === 'tg01'
          ? { student_hmid: 'HM12345' }
          : { student_hmid: 'HM-GV01' };
      },
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

test('quét lại vá student_hmid null và chuẩn hóa name của trợ giảng', async () => {
  const updates: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async ({ where }: any) => where.can_view_stream_key === 1
        ? [{ username: 'gv01', display_name: 'Giáo viên 01' }]
        : [{ username: 'tg01', display_name: 'Trợ giảng 01' }],
    },
    users: {
      findFirst: async ({ where }: any) => {
        const username = where.username;
        if (where.learn_number !== undefined) {
          return username === 'tg01'
            ? { id: 2, student_hmid: null, name: 'Trợ giảng 01' }
            : { id: 1, student_hmid: 'HM-GV01', name: 'Giáo viên 01' };
        }
        return username === 'tg01' ? { student_hmid: 'HM12345' } : null;
      },
      update: async (input: any) => { updates.push(input); },
      create: async () => undefined,
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

  assert.equal(result.created, 0);
  assert.equal(result.updated, 2);
  assert.equal(updates.length, 2);
  const assistantUpdate = updates.find((item) => item.where.id === 2);
  assert.equal(assistantUpdate.data.student_hmid, 'HM12345');
  assert.equal(assistantUpdate.data.name, 'HM12345 - Giáo viên');
});

test('vá HMID ưu tiên giá trị cùng chương trình khi username có HMID khác ở chương trình khác', async () => {
  const updates: any[] = [];
  let globalFallbackCalled = false;
  const client = {
    teacher_profiles: {
      findMany: async () => [{ username: 'gv01', display_name: 'Giáo viên 01' }],
    },
    users: {
      findFirst: async ({ where }: any) => {
        if (where.learn_number !== undefined) {
          return { id: 5, student_hmid: null, name: 'Giáo viên 01' };
        }
        if (where.code === 'sinhhoc-7-2027') return { student_hmid: '3589517' };
        globalFallbackCalled = true;
        return { student_hmid: '1000009' };
      },
      update: async (input: any) => { updates.push(input); },
      create: async () => undefined,
    },
  };

  const result = await ensureCalendarTeachingUsers(client, {
    code: 'sinhhoc-7-2027',
    learn_number: 2,
    start_time: '2026-08-27T01:00:00.000Z',
    teacher: 'Giáo viên 01',
    assistant_teacher: null,
    lesson_status: 0,
  });

  assert.equal(result.updated, 1);
  assert.equal(updates[0].data.student_hmid, '3589517');
  assert.equal(globalFallbackCalled, false);
});

test('đổi ngày cập nhật class_id trên đúng user hiện tại, không tạo identity mới', async () => {
  const updates: any[] = [];
  const deletes: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async () => [{ username: 'gv01', display_name: 'Giáo viên 01' }],
    },
    users: {
      findFirst: async () => null,
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

  assert.equal(
    updates[0].where.code,
    'tongondinhluonghsav2027'
  );
  assert.equal(updates[0].where.class_id, undefined);
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
  assert.equal(deletes[0].where.class_id, undefined);
  assert.equal(deletes[0].where.room_id, 1);
  assert.equal(deletes[0].where.islearn, 0);
});

test('đổi giáo viên tạo người mới và thu hồi người cũ nếu không còn lịch khác', async () => {
  const creates: any[] = [];
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
      create: async (input: any) => { creates.push(input); },
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

  assert.equal(creates[0].data.username, 'gv-b');
  assert.equal(deletes[0].where.username, 'gv-a');
  assert.equal(deletes[0].where.code, 'tongondinhluonghsav2027');
  assert.equal(deletes[0].where.learn_number, 9);
  assert.equal(deletes[0].where.room_id, 1);
  assert.equal(deletes[0].where.islearn, 0);
});

test('đổi đồng thời giáo viên và trợ giảng tạo người mới, thu hồi cả hai người cũ', async () => {
  const creates: any[] = [];
  const deletes: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async ({ where }: any) => {
        if (where.can_view_stream_key === 1) {
          const identifier = where.OR[0].username;
          return [{
            username: identifier === 'Giáo viên cũ' ? 'gv-cu' : 'gv-moi',
            display_name: identifier,
          }];
        }
        return (where.username.in as string[]).map((username) => ({
          username,
          display_name: username === 'tg-cu' ? 'Trợ giảng cũ' : 'Trợ giảng mới',
        }));
      },
    },
    users: {
      findFirst: async () => null,
      create: async (input: any) => { creates.push(input); },
      deleteMany: async (input: any) => { deletes.push(input); },
    },
    $queryRaw: async () => [],
  };
  const base = {
    id: 10,
    code: 'sinhhoc-7-2027',
    learn_number: 1,
    start_time: '2026-08-22T19:00:00.000Z',
    lesson_status: 0,
  };

  await syncCalendarTeachingUsers(
    client,
    { ...base, teacher: 'Giáo viên cũ', assistant_teacher: 'tg-cu' },
    { ...base, teacher: 'Giáo viên mới', assistant_teacher: 'tg-moi' }
  );

  assert.deepEqual(
    creates.map((item) => item.data.username),
    ['gv-moi', 'tg-moi']
  );
  assert.deepEqual(
    deletes.map((item) => item.where.username),
    ['gv-cu', 'tg-cu']
  );
  assert.ok(deletes.every((item) => (
    item.where.code === 'sinhhoc-7-2027'
    && item.where.learn_number === 1
  )));
});

test('không thu hồi giáo viên hoặc trợ giảng cũ khi còn buổi khác cùng chương trình và bài đang dùng', async () => {
  const creates: any[] = [];
  const deletes: any[] = [];
  const client = {
    teacher_profiles: {
      findMany: async ({ where }: any) => {
        if (where.can_view_stream_key === 1) {
          const identifier = where.OR[0].username;
          return [{
            username: identifier === 'Giáo viên cũ' ? 'gv-cu' : 'gv-moi',
            display_name: identifier,
          }];
        }
        return (where.username.in as string[]).map((username) => ({
          username,
          display_name: username,
        }));
      },
    },
    users: {
      findFirst: async () => null,
      create: async (input: any) => { creates.push(input); },
      deleteMany: async (input: any) => { deletes.push(input); },
    },
    // Mô phỏng một buổi khác cùng code + learn_number vẫn đang gắn người cũ.
    $queryRaw: async () => [{
      start_time: '2026-08-22T19:00:00.000Z',
      teacher: 'Giáo viên cũ',
      assistant_teacher: 'tg-cu',
    }],
  };
  const base = {
    id: 10,
    code: 'sinhhoc-7-2027',
    learn_number: 1,
    start_time: '2026-08-22T19:00:00.000Z',
    lesson_status: 0,
  };

  await syncCalendarTeachingUsers(
    client,
    { ...base, teacher: 'Giáo viên cũ', assistant_teacher: 'tg-cu' },
    { ...base, teacher: 'Giáo viên mới', assistant_teacher: 'tg-moi' }
  );

  assert.deepEqual(
    creates.map((item) => item.data.username),
    ['gv-moi', 'tg-moi']
  );
  assert.equal(deletes.length, 0);
});
