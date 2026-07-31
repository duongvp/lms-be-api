import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import ApiError from '../../utils/ApiError';
import {
  TEACHER_TYPES,
  TeacherProfileListQuery,
  TeacherProfileImportMode,
  TeacherProfileImportRow,
  TeacherProfilePayload,
  TeacherType,
} from './teacher-profile.types';

type TeacherProfileRow = {
  id: number | bigint;
  username: string;
  teacher_type: number;
  display_name: string | null;
  status: number;
  created_at: Date | null;
  updated_at: Date | null;
};

const normalizeProfileRow = (row: TeacherProfileRow) => ({
  ...row,
  id: Number(row.id),
  teacher_type: Number(row.teacher_type),
  status: Number(row.status),
});

const assistantUsernames = (value: string | null) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const findUsage = async (username: string) => {
  const [teacherRows, possibleAssistantRows] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COUNT(*) AS total
      FROM calendar
      WHERE teacher = ${username}
    `,
    prisma.$queryRaw<Array<{ assistant_teacher: string | null }>>`
      SELECT assistant_teacher
      FROM calendar
      WHERE assistant_teacher LIKE ${`%${username}%`}
    `,
  ]);
  return {
    teacherCount: Number(teacherRows[0]?.total ?? 0),
    assistantCount: possibleAssistantRows.filter((row) =>
      assistantUsernames(row.assistant_teacher).includes(username)
    ).length,
  };
};

const getProfileRow = async (id: number) => {
  const rows = await prisma.$queryRaw<TeacherProfileRow[]>`
    SELECT id, username, teacher_type, display_name, status, created_at, updated_at
    FROM teacher_profiles
    WHERE id = ${id}
    LIMIT 1
  `;
  const profile = rows[0] ? normalizeProfileRow(rows[0]) : undefined;
  if (!profile) throw new ApiError('Không tìm thấy nhân sự giảng dạy', 404);
  return profile;
};

const throwDatabaseError = (error: unknown): never => {
  const message = String((error as any)?.message || '');
  if (message.includes('1062') || message.toLowerCase().includes('duplicate')) {
    throw new ApiError('Mã nhân sự đã tồn tại', 409);
  }
  throw error;
};

export const listTeacherProfiles = async (query: TeacherProfileListQuery) => {
  const conditions: Prisma.Sql[] = [];
  if (query.teacher_type !== undefined) {
    conditions.push(Prisma.sql`teacher_type = ${query.teacher_type}`);
  }
  if (query.status !== undefined) {
    conditions.push(Prisma.sql`status = ${query.status}`);
  }
  if (query.search) {
    const pattern = `%${query.search}%`;
    conditions.push(Prisma.sql`(username LIKE ${pattern} OR display_name LIKE ${pattern})`);
  }
  const where = conditions.length
    ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
    : Prisma.empty;
  const offset = (query.page - 1) * query.limit;

  const [countRows, data] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
      SELECT COUNT(*) AS total
      FROM teacher_profiles
      ${where}
    `),
    prisma.$queryRaw<TeacherProfileRow[]>(Prisma.sql`
      SELECT id, username, teacher_type, display_name, status, created_at, updated_at
      FROM teacher_profiles
      ${where}
      ORDER BY status DESC, display_name ASC, username ASC
      LIMIT ${query.limit} OFFSET ${offset}
    `),
  ]);

  return {
    data: data.map(normalizeProfileRow),
    pagination: {
      page: query.page,
      limit: query.limit,
      total: Number(countRows[0]?.total ?? 0),
    },
  };
};

export const getTeacherProfile = getProfileRow;

export const createTeacherProfile = async (payload: TeacherProfilePayload) => {
  try {
    await prisma.$executeRaw`
      INSERT INTO teacher_profiles (
        username, display_name, teacher_type, status, created_at, updated_at
      ) VALUES (
        ${payload.username!},
        ${payload.display_name ?? null},
        ${payload.teacher_type ?? TEACHER_TYPES.TEACHER},
        ${payload.status ?? 1},
        NOW(),
        NOW()
      )
    `;
    const rows = await prisma.$queryRaw<TeacherProfileRow[]>`
      SELECT id, username, teacher_type, display_name, status, created_at, updated_at
      FROM teacher_profiles
      WHERE username = ${payload.username!}
      LIMIT 1
    `;
    return rows[0] ? normalizeProfileRow(rows[0]) : undefined;
  } catch (error) {
    return throwDatabaseError(error);
  }
};

const assertTypeCanChange = async (
  username: string,
  currentType: number,
  nextType?: TeacherType
) => {
  if (nextType === undefined || nextType === currentType) return;
  const usage = await findUsage(username);
  if (usage.teacherCount > 0 || usage.assistantCount > 0) {
    throw new ApiError(
      'Không thể đổi loại nhân sự vì username đang được sử dụng trong lịch học',
      409
    );
  }
};

export const updateTeacherProfile = async (
  id: number,
  payload: TeacherProfilePayload
) => {
  const current = await getProfileRow(id);
  await assertTypeCanChange(current.username, current.teacher_type, payload.teacher_type);

  const assignments: Prisma.Sql[] = [];
  if (payload.display_name !== undefined) {
    assignments.push(Prisma.sql`display_name = ${payload.display_name}`);
  }
  if (payload.teacher_type !== undefined) {
    assignments.push(Prisma.sql`teacher_type = ${payload.teacher_type}`);
  }
  if (payload.status !== undefined) {
    assignments.push(Prisma.sql`status = ${payload.status}`);
  }
  assignments.push(Prisma.sql`updated_at = NOW()`);

  await prisma.$executeRaw(Prisma.sql`
    UPDATE teacher_profiles
    SET ${Prisma.join(assignments, ', ')}
    WHERE id = ${id}
  `);
  return getProfileRow(id);
};

export const updateTeacherProfileStatus = async (id: number, status: 0 | 1) => {
  await getProfileRow(id);
  await prisma.$executeRaw`
    UPDATE teacher_profiles
    SET status = ${status}, updated_at = NOW()
    WHERE id = ${id}
  `;
  return getProfileRow(id);
};

export const deleteTeacherProfile = async (id: number) => {
  const current = await getProfileRow(id);
  const usage = await findUsage(current.username);
  if (usage.teacherCount > 0 || usage.assistantCount > 0) {
    throw new ApiError(
      'Không thể xóa nhân sự đang được sử dụng trong lịch học; hãy chuyển sang trạng thái ngừng hoạt động',
      409
    );
  }
  await prisma.$executeRaw`DELETE FROM teacher_profiles WHERE id = ${id}`;
  return current;
};

export const getTeacherProfilesForExport = async (
  filters: Omit<TeacherProfileListQuery, 'page' | 'limit'>
) => {
  const rows: Array<ReturnType<typeof normalizeProfileRow>> = [];
  let page = 1;
  let total = 0;
  do {
    const result = await listTeacherProfiles({
      ...filters,
      page,
      limit: 100,
    });
    rows.push(...result.data);
    total = result.pagination.total;
    page += 1;
  } while (rows.length < total);
  return rows;
};

export const importTeacherProfiles = async (
  rows: TeacherProfileImportRow[],
  mode: TeacherProfileImportMode
) => prisma.$transaction(async (tx) => {
  const usernames = rows.map((row) => row.username);
  const existingRows = usernames.length
    ? await tx.$queryRaw<TeacherProfileRow[]>(Prisma.sql`
        SELECT id, username, teacher_type, display_name, status, created_at, updated_at
        FROM teacher_profiles
        WHERE username IN (${Prisma.join(usernames)})
      `)
    : [];
  const existingByUsername = new Map(
    existingRows.map((row) => [row.username.toLowerCase(), normalizeProfileRow(row)])
  );

  const typeChanges = rows.filter((row) => {
    const current = existingByUsername.get(row.username.toLowerCase());
    return current && current.teacher_type !== row.teacher_type;
  });
  if (mode === 'overwrite' && typeChanges.length) {
    const changingUsernames = new Set(
      typeChanges.map((row) => row.username.toLowerCase())
    );
    const usageConditions = typeChanges.flatMap((row) => [
      Prisma.sql`teacher = ${row.username}`,
      Prisma.sql`assistant_teacher LIKE ${`%${row.username}%`}`,
    ]);
    const calendarRows = await tx.$queryRaw<Array<{
      teacher: string | null;
      assistant_teacher: string | null;
    }>>(Prisma.sql`
      SELECT teacher, assistant_teacher
      FROM calendar
      WHERE ${Prisma.join(usageConditions, ' OR ')}
    `);
    const usedUsernames = new Set<string>();
    calendarRows.forEach((calendar) => {
      const teacher = String(calendar.teacher || '').toLowerCase();
      if (changingUsernames.has(teacher)) usedUsernames.add(teacher);
      assistantUsernames(calendar.assistant_teacher).forEach((assistant) => {
        const normalized = assistant.toLowerCase();
        if (changingUsernames.has(normalized)) usedUsernames.add(normalized);
      });
    });
    if (usedUsernames.size) {
      const labels = typeChanges
        .filter((row) => usedUsernames.has(row.username.toLowerCase()))
        .map((row) => `${row.username} (dòng ${row.row})`);
      throw new ApiError(
        `Không thể đổi loại nhân sự đang được dùng trong lịch: ${labels.join(', ')}`,
        409
      );
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const existing = existingByUsername.get(row.username.toLowerCase());
    if (existing) {
      if (mode === 'skip') {
        skipped += 1;
        continue;
      }
      await tx.$executeRaw`
        UPDATE teacher_profiles
        SET
          display_name = ${row.display_name},
          teacher_type = ${row.teacher_type},
          status = ${row.status},
          updated_at = NOW()
        WHERE id = ${existing.id}
      `;
      updated += 1;
      continue;
    }
    await tx.$executeRaw`
      INSERT INTO teacher_profiles (
        username, display_name, teacher_type, status, created_at, updated_at
      ) VALUES (
        ${row.username},
        ${row.display_name},
        ${row.teacher_type},
        ${row.status},
        NOW(),
        NOW()
      )
    `;
    created += 1;
  }

  return { total: rows.length, created, updated, skipped };
});
