import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import {
  assignTopClassStudents,
  assignTopUniStudents,
  ClassroomAssignmentPlan,
  ClassroomAssignmentStudent,
  ClassroomTarget,
  ClassroomSystemType,
} from './classroom-assignment.algorithm';

type AssignmentActor = {
  username?: string | null;
};

type AssignmentRosterRow = {
  id: number;
  username: string;
  student_hmid: string | null;
  name: string;
  room_id: number | null;
  class_id: string | null;
};

type InteractionRow = {
  user_hmid: string;
  interaction_score: bigint | number;
};

type AssignmentContext = {
  calendar: {
    id: number;
    code: string;
    learn_number: number;
    system_type: ClassroomSystemType;
    start_time: Date;
  };
  roster: AssignmentRosterRow[];
  plan: ClassroomAssignmentPlan;
};

const normalizeSystemType = (value: unknown): ClassroomSystemType => {
  if (value === 'topclass' || value === 'topuni') return value;
  throw new Error('Lịch học chưa có system_type TopClass/TopUni hợp lệ');
};

const getStudentIdentity = (student: AssignmentRosterRow) => {
  const hmid = String(student.student_hmid || '').trim();
  if (hmid) return hmid;
  const leadingId = String(student.name || '').trim().match(/^(\d+)/)?.[1];
  return leadingId || String(student.username).trim();
};

const loadAssignmentContext = async (client: any, calendarId: number): Promise<AssignmentContext> => {
  if (!Number.isInteger(calendarId) || calendarId <= 0) {
    throw new Error('calendar_id không hợp lệ');
  }

  const calendar = await client.calendar.findUnique({
    where: { id: calendarId },
    select: {
      id: true,
      code: true,
      learn_number: true,
      system_type: true,
      start_time: true,
    },
  });
  if (!calendar) throw new Error('Không tìm thấy lịch học');

  const systemType = normalizeSystemType(calendar.system_type || 'topclass');
  const overlappingSystems = await client.calendar.findMany({
    where: { code: calendar.code, learn_number: calendar.learn_number },
    select: { system_type: true },
    distinct: ['system_type'],
  });
  if (new Set(overlappingSystems.map((item: any) => item.system_type)).size > 1) {
    throw new Error(
      'Không thể phân lớp vì code + learn_number đang được dùng cho cả TopClass và TopUni'
    );
  }

  const roster = await client.$queryRaw(Prisma.sql`
    SELECT
      student.id,
      student.username,
      student.student_hmid,
      student.name,
      student.room_id,
      student.class_id
    FROM users AS student
    LEFT JOIN teacher_profiles AS staff
      ON staff.username = student.username
    WHERE student.code = ${calendar.code}
      AND student.learn_number = ${calendar.learn_number}
      AND student.room_id IS NOT NULL
      AND staff.id IS NULL
    ORDER BY student.id ASC
  `) as AssignmentRosterRow[];

  const streamRows = await client.stream.findMany({
    where: {
      code: calendar.code,
      learn_number: calendar.learn_number,
      class_id: { not: null },
    },
    select: { room_id: true, class_id: true },
    orderBy: [{ room_id: 'asc' }, { class_id: 'asc' }],
  });
  const availableTargets: ClassroomTarget[] = streamRows
    .map((item: any) => ({
      roomId: Number(item.room_id),
      classId: String(item.class_id || '').trim(),
    }))
    .filter((item: ClassroomTarget) => Number.isInteger(item.roomId) && item.roomId > 0 && item.classId)
    .filter((item: ClassroomTarget, index: number, items: ClassroomTarget[]) => (
      items.findIndex((candidate) => candidate.roomId === item.roomId) === index
    ));
  const invalidTarget = availableTargets.find(
    (target) => !target.classId.endsWith(String(target.roomId))
  );
  if (invalidTarget) {
    throw new Error(
      `class_id ${invalidTarget.classId} không kết thúc bằng room_id ${invalidTarget.roomId}`
    );
  }

  const interactionRows: InteractionRow[] = systemType === 'topuni' && roster.length
    ? await client.$queryRaw(Prisma.sql`
        SELECT
          CAST(chat.user_hmid AS CHAR) AS user_hmid,
          COUNT(*) AS interaction_score
        FROM logs_chat_new AS chat
        WHERE chat.code = ${calendar.code}
          AND chat.mess_time < ${calendar.start_time}
          AND LOWER(chat.user_role) = 'student'
          AND LOWER(chat.mess_status) IN ('active', 'sent')
          AND EXISTS (
            SELECT 1
            FROM calendar AS historical_calendar
            WHERE historical_calendar.code = chat.code
              AND historical_calendar.learn_number = chat.learn_number
              AND historical_calendar.system_type = 'topuni'
              AND historical_calendar.start_time < ${calendar.start_time}
          )
        GROUP BY chat.user_hmid
      `) as InteractionRow[]
    : [];
  const interactionByHmid = new Map(
    interactionRows.map((item) => [String(item.user_hmid), Number(item.interaction_score) || 0])
  );

  const students: ClassroomAssignmentStudent[] = roster.map((student) => {
    const identity = getStudentIdentity(student);
    return {
      id: student.id,
      identity,
      currentRoomId: student.room_id,
      currentClassId: student.class_id,
      interactionScore: interactionByHmid.get(identity) || 0,
    };
  });

  const plan = systemType === 'topuni'
    ? assignTopUniStudents(students, availableTargets)
    : assignTopClassStudents(students, availableTargets);

  return {
    calendar: {
      id: calendar.id,
      code: calendar.code,
      learn_number: calendar.learn_number,
      system_type: systemType,
      start_time: calendar.start_time,
    },
    roster,
    plan,
  };
};

const toResponse = (context: AssignmentContext, operationId?: string) => ({
  operation_id: operationId,
  calendar: context.calendar,
  total_students: context.roster.length,
  classroom_count: context.plan.classroomCount,
  moved_count: context.plan.movedCount,
  classrooms: context.plan.summaries,
  assignments: context.plan.assignments.map((assignment) => ({
    user_id: assignment.id,
    identity: assignment.identity,
    previous_room_id: assignment.currentRoomId,
    new_room_id: assignment.targetRoomId,
    previous_class_id: assignment.currentClassId,
    new_class_id: assignment.targetClassId,
    interaction_score: assignment.interactionScore,
    changed: assignment.currentClassId !== assignment.targetClassId,
  })),
});

export const previewClassroomAssignment = async (calendarId: number) => (
  toResponse(await loadAssignmentContext(prisma, calendarId))
);

export const applyClassroomAssignment = async (
  calendarId: number,
  actor: AssignmentActor = {}
) => prisma.$transaction(async (tx) => {
  // Rebuild inside the transaction so apply never commits a stale preview.
  const context = await loadAssignmentContext(tx, calendarId);
  const changes = context.plan.assignments.filter(
    (assignment) => assignment.currentRoomId !== assignment.targetRoomId
      || assignment.currentClassId !== assignment.targetClassId
  );
  if (!changes.length) return toResponse(context);

  const operationId = randomUUID();
  const rosterById = new Map(context.roster.map((student) => [student.id, student]));
  const historyRows = changes.map((assignment) => {
    const student = rosterById.get(assignment.id);
    if (!student) throw new Error(`Không tìm thấy user ${assignment.id} trong roster`);
    return Prisma.sql`(
      ${operationId},
      ${context.calendar.id},
      ${student.id},
      ${student.username},
      ${context.calendar.code},
      ${context.calendar.learn_number},
      ${context.calendar.system_type},
      ${assignment.currentRoomId},
      ${assignment.targetRoomId},
      ${assignment.currentClassId},
      ${assignment.targetClassId},
      ${assignment.interactionScore},
      ${String(actor.username || '').trim() || null}
    )`;
  });

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO classroom_assignment_history (
      operation_id, calendar_id, user_id, username, code, learn_number,
      system_type, previous_room_id, new_room_id, previous_class_id, new_class_id,
      interaction_score, created_by
    ) VALUES ${Prisma.join(historyRows)}
  `);

  const changesByClass = new Map<string, { roomId: number; classId: string; ids: number[] }>();
  changes.forEach((assignment) => {
    const key = `${assignment.targetRoomId}:${assignment.targetClassId}`;
    const group = changesByClass.get(key) || {
      roomId: assignment.targetRoomId,
      classId: assignment.targetClassId,
      ids: [],
    };
    group.ids.push(assignment.id);
    changesByClass.set(key, group);
  });

  let updatedCount = 0;
  for (const { roomId, classId, ids } of changesByClass.values()) {
    const result = await tx.users.updateMany({
      where: {
        id: { in: ids },
        code: context.calendar.code,
        learn_number: context.calendar.learn_number,
      },
      data: { room_id: roomId, class_id: classId },
    });
    updatedCount += result.count;
  }
  if (updatedCount !== changes.length) {
    throw new Error(
      `Roster đã thay đổi trong lúc phân lớp: dự kiến ${changes.length}, cập nhật ${updatedCount}`
    );
  }

  return toResponse(context, operationId);
}, {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  timeout: 30_000,
});
