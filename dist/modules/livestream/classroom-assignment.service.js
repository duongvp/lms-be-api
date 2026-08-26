"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyClassroomAssignment = exports.previewClassroomAssignment = exports.summarizeTopClassLessonAttendance = exports.normalizeClassroomAssignmentId = void 0;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../../lib/prisma"));
const classroom_assignment_algorithm_1 = require("./classroom-assignment.algorithm");
const calendar_user_sync_service_1 = require("./calendar-user-sync.service");
const normalizeMaxStudentsPerClassroom = (value) => {
    if (value === undefined || value === null || value === '') {
        return classroom_assignment_algorithm_1.TOPUNI_MAX_STUDENTS_PER_CLASSROOM;
    }
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 1 || normalized > 10_000) {
        throw new Error('Số học sinh tối đa mỗi phòng phải là số nguyên từ 1 đến 10.000');
    }
    return normalized;
};
const normalizeSystemType = (value) => {
    if (value === 'topclass' || value === 'topuni')
        return value;
    throw new Error('Lịch học chưa có system_type TopClass/TopUni hợp lệ');
};
const normalizeClassroomAssignmentId = (value) => {
    const normalized = Number(value);
    if (!Number.isSafeInteger(normalized) || normalized <= 0) {
        throw new Error(`users.id không hợp lệ cho phân lớp: ${String(value)}`);
    }
    return normalized;
};
exports.normalizeClassroomAssignmentId = normalizeClassroomAssignmentId;
const getStudentIdentity = (student) => {
    const hmid = String(student.student_hmid || '').trim();
    if (hmid)
        return hmid;
    const leadingId = String(student.name || '').trim().match(/^(\d+)/)?.[1];
    return leadingId || String(student.username).trim();
};
const normalizeUsername = (value) => String(value || '').trim().toLowerCase();
const topClassLessonKey = (calendar) => calendar.session_id !== null
    ? `session:${String(calendar.session_id)}`
    : `learn:${calendar.learn_number}`;
const summarizeTopClassLessonAttendance = (rows) => ({
    usable: rows.some((row) => Number(row.attendance_minutes) > 0),
    attended: new Set(rows
        .filter((row) => Number(row.attendance_minutes) >= 5)
        .map((row) => normalizeUsername(row.username))),
});
exports.summarizeTopClassLessonAttendance = summarizeTopClassLessonAttendance;
const loadRecentAttendanceByUsername = async (client, calendar, roster) => {
    if (!roster.length)
        return null;
    const completedBefore = new Date(Math.min(calendar.start_time.getTime(), Date.now()));
    const completedCalendars = await client.calendar.findMany({
        where: {
            code: calendar.code,
            system_type: 'topclass',
            OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }],
            end_time: { lt: completedBefore },
        },
        select: {
            id: true,
            session_id: true,
            learn_number: true,
            start_time: true,
            end_time: true,
        },
        orderBy: [{ end_time: 'desc' }, { id: 'desc' }],
    });
    if (!completedCalendars.length)
        return null;
    const usernames = [...new Set(roster.map((student) => normalizeUsername(student.username)))]
        .filter(Boolean);
    if (!usernames.length)
        return null;
    const groups = new Map();
    completedCalendars.forEach((item) => {
        const key = topClassLessonKey(item);
        groups.set(key, [...(groups.get(key) || []), item]);
    });
    const currentLessonKey = topClassLessonKey(calendar);
    const previousCurrentOccurrences = groups.get(currentLessonKey) || [];
    const recentLessonGroups = [...groups.entries()]
        .filter(([key]) => key !== currentLessonKey)
        .sort((left, right) => (Math.max(...right[1].map((item) => item.end_time.getTime()))
        - Math.max(...left[1].map((item) => item.end_time.getTime()))))
        .slice(0, 3);
    const selectedGroups = [
        ...recentLessonGroups,
        ...(previousCurrentOccurrences.length
            ? [[currentLessonKey, previousCurrentOccurrences]]
            : []),
    ];
    const selectedOccurrences = selectedGroups.flatMap(([, occurrences]) => occurrences);
    if (!selectedOccurrences.length)
        return null;
    const attendanceWindows = selectedOccurrences.map((item) => client_1.Prisma.sql `
    SELECT
      ${item.id} AS occurrence_id,
      ${item.learn_number} AS learn_number,
      ${item.start_time} AS start_time,
      ${item.end_time} AS end_time
  `);
    const rows = await client.$queryRaw(client_1.Prisma.sql `
    WITH attendance_windows AS (
      ${client_1.Prisma.join(attendanceWindows, ' UNION ALL ')}
    )
    SELECT
      attendance_window.occurrence_id,
      LOWER(TRIM(log.username)) AS username,
      SUM(
        CASE
          WHEN log.status = 1 THEN 1
          WHEN log.status = 2 THEN 5
          ELSE 0
        END
      ) AS attendance_minutes
    FROM attendance_windows AS attendance_window
    JOIN users_logs AS log
      ON log.code = ${calendar.code}
     AND log.learn_number = attendance_window.learn_number
     AND log.created_at >= attendance_window.start_time
     AND log.created_at <= attendance_window.end_time
    WHERE LOWER(TRIM(log.username)) IN (${client_1.Prisma.join(usernames)})
    GROUP BY attendance_window.occurrence_id, LOWER(TRIM(log.username))
  `);
    const rowsByOccurrence = new Map();
    rows.forEach((row) => {
        const occurrenceId = Number(row.occurrence_id);
        rowsByOccurrence.set(occurrenceId, [
            ...(rowsByOccurrence.get(occurrenceId) || []),
            row,
        ]);
    });
    const signalForGroup = (occurrences) => {
        const groupRows = occurrences.flatMap((item) => rowsByOccurrence.get(item.id) || []);
        return (0, exports.summarizeTopClassLessonAttendance)(groupRows);
    };
    // Mỗi nội dung chỉ đóng góp tối đa một điểm chuyên cần, dù được dạy lại
    // nhiều lần. Một học sinh học bất kỳ lần nào là đã hoàn thành nội dung đó.
    const recentSignals = recentLessonGroups
        .map(([, occurrences]) => signalForGroup(occurrences))
        .filter((signal) => signal.usable);
    const attendanceByUsername = new Map(usernames.map((username) => [
        username,
        recentSignals.filter((signal) => signal.attended.has(username)).length,
    ]));
    const currentLessonSignal = previousCurrentOccurrences.length
        ? signalForGroup(previousCurrentOccurrences)
        : null;
    const makeupSignalApplied = Boolean(currentLessonSignal?.usable);
    const needsMakeup = new Map();
    if (makeupSignalApplied && currentLessonSignal) {
        usernames.forEach((username) => {
            needsMakeup.set(username, !currentLessonSignal.attended.has(username));
        });
    }
    if (!recentSignals.length && !makeupSignalApplied)
        return null;
    const needsMakeupCount = [...needsMakeup.values()].filter(Boolean).length;
    const distribution = [...attendanceByUsername.values()].reduce((result, count) => {
        result[count] += 1;
        return result;
    }, { 0: 0, 1: 0, 2: 0, 3: 0 });
    return {
        counts: attendanceByUsername,
        distribution,
        populationCount: usernames.length,
        lessonCount: recentSignals.length,
        isRepeatLesson: previousCurrentOccurrences.length > 0,
        priorOccurrenceCount: previousCurrentOccurrences.length,
        makeupSignalApplied,
        needsMakeup,
        alreadyCoveredCount: makeupSignalApplied ? usernames.length - needsMakeupCount : 0,
        needsMakeupCount: makeupSignalApplied ? needsMakeupCount : 0,
    };
};
const loadAssignmentContext = async (client, calendarId, options = {}) => {
    if (!Number.isInteger(calendarId) || calendarId <= 0) {
        throw new Error('calendar_id không hợp lệ');
    }
    const calendar = await client.calendar.findUnique({
        where: { id: calendarId },
        select: {
            id: true,
            code: true,
            session_id: true,
            learn_number: true,
            system_type: true,
            start_time: true,
        },
    });
    if (!calendar)
        throw new Error('Không tìm thấy lịch học');
    const schedulableRows = await client.$queryRaw(client_1.Prisma.sql `
    SELECT calendar_row.id
    FROM calendar AS calendar_row
    LEFT JOIN lessons AS session_lesson
      ON session_lesson.id = calendar_row.session_id
     AND session_lesson.status <> 0
    WHERE calendar_row.id = ${calendar.id}
      AND (
        session_lesson.id IS NOT NULL
        OR (
          calendar_row.session_id IS NULL
          AND EXISTS (
            SELECT 1
            FROM lessons AS legacy_lesson
            WHERE legacy_lesson.subject_code = calendar_row.code
              AND legacy_lesson.learn_number = calendar_row.learn_number
              AND legacy_lesson.status <> 0
          )
        )
      )
    LIMIT 1
  `);
    if (!schedulableRows.length) {
        throw new Error('Lịch học không liên kết với đề cương hợp lệ nên không thể phân lớp');
    }
    const systemType = normalizeSystemType(calendar.system_type || 'topclass');
    const maxStudentsPerClassroom = systemType === 'topuni'
        ? normalizeMaxStudentsPerClassroom(options.maxStudentsPerClassroom)
        : null;
    const overlappingSystems = await client.calendar.findMany({
        where: { code: calendar.code, learn_number: calendar.learn_number },
        select: { system_type: true },
        distinct: ['system_type'],
    });
    if (new Set(overlappingSystems.map((item) => item.system_type)).size > 1) {
        throw new Error('Không thể phân lớp vì code + learn_number đang được dùng cho cả TopClass và TopUni');
    }
    const streamRows = await client.stream.findMany({
        where: {
            code: calendar.code,
            learn_number: calendar.learn_number,
            class_id: { not: null },
        },
        select: { room_id: true, class_id: true },
        orderBy: [{ room_id: 'asc' }, { class_id: 'asc' }],
    });
    const availableTargets = streamRows
        .filter((item) => Number.isInteger(Number(item.room_id)) && Number(item.room_id) > 0)
        .map((item) => ({
        roomId: Number(item.room_id),
        // stream xác định những room nào đang được cấu hình. class_id phải thuộc
        // chính calendar đang thao tác, không tái sử dụng ngày của buổi khác.
        classId: (0, calendar_user_sync_service_1.buildCalendarRoomClassId)(calendar.code, calendar.start_time, calendar.learn_number, Number(item.room_id)),
    }))
        .filter((item, index, items) => (items.findIndex((candidate) => candidate.roomId === item.roomId) === index));
    const roomOneClassId = (0, calendar_user_sync_service_1.buildCalendarClassId)(calendar.code, calendar.start_time, calendar.learn_number);
    const classIdPrefix = roomOneClassId.slice(0, -1);
    const rawRoster = await client.$queryRaw(client_1.Prisma.sql `
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
      AND CAST(student.class_id AS BINARY) = CAST(
        CONCAT(${classIdPrefix}, CAST(student.room_id AS CHAR)) AS BINARY
      )
      AND staff.id IS NULL
    ORDER BY student.id ASC
  `);
    // MySQL raw query có thể trả cột INT UNSIGNED dưới dạng BigInt. Prisma
    // users.updateMany lại yêu cầu number cho trường Int, nên chuẩn hóa một lần
    // trước khi lập plan/history và tuyệt đối không truyền BigInt vào `id.in`.
    const roster = rawRoster.map((student) => ({
        ...student,
        id: (0, exports.normalizeClassroomAssignmentId)(student.id),
        room_id: student.room_id === null
            ? null
            : (0, exports.normalizeClassroomAssignmentId)(student.room_id),
    }));
    const previousRoomByIdentity = new Map();
    const previousStudentIdentities = [];
    const previousTopClassRoster = [];
    let previousTopUniLearnNumber = null;
    {
        const previousCalendar = await client.calendar.findFirst({
            where: {
                code: calendar.code,
                system_type: systemType,
                OR: [{ lesson_status: null }, { lesson_status: { not: 1 } }],
                start_time: { lt: calendar.start_time },
            },
            select: { learn_number: true, start_time: true },
            orderBy: [{ start_time: 'desc' }, { id: 'desc' }],
        });
        if (previousCalendar) {
            if (systemType === 'topuni') {
                previousTopUniLearnNumber = previousCalendar.learn_number;
            }
            const previousRoomOneClassId = (0, calendar_user_sync_service_1.buildCalendarClassId)(calendar.code, previousCalendar.start_time, previousCalendar.learn_number);
            const previousClassIdPrefix = previousRoomOneClassId.slice(0, -1);
            const previousRoster = await client.$queryRaw(client_1.Prisma.sql `
        SELECT
          previous_student.id,
          previous_student.username,
          previous_student.student_hmid,
          previous_student.name,
          previous_student.room_id,
          previous_student.class_id
        FROM users AS previous_student
        LEFT JOIN teacher_profiles AS previous_staff
          ON previous_staff.username = previous_student.username
        WHERE previous_student.code = ${calendar.code}
          AND previous_student.learn_number = ${previousCalendar.learn_number}
          AND previous_staff.id IS NULL
        ORDER BY previous_student.id ASC
      `);
            previousRoster.forEach((student) => {
                const roomId = student.room_id === null
                    ? null
                    : (0, exports.normalizeClassroomAssignmentId)(student.room_id);
                const identity = getStudentIdentity({
                    ...student,
                    id: (0, exports.normalizeClassroomAssignmentId)(student.id),
                    room_id: roomId,
                });
                previousStudentIdentities.push(identity);
                if (systemType === 'topclass') {
                    previousTopClassRoster.push({
                        ...student,
                        id: (0, exports.normalizeClassroomAssignmentId)(student.id),
                        room_id: roomId,
                    });
                }
                // Mẫu số thống kê gồm toàn bộ học sinh đã được thêm vào bài trước.
                // Chỉ dùng room làm dữ liệu kế thừa khi class_id thực sự thuộc đúng
                // lịch đó, tránh mang phòng của một buổi khác sang phương án hiện tại.
                if (roomId !== null
                    && student.class_id === `${previousClassIdPrefix}${roomId}`) {
                    previousRoomByIdentity.set(identity, roomId);
                }
            });
        }
    }
    const recentAttendance = systemType === 'topclass'
        ? await loadRecentAttendanceByUsername(client, calendar, roster.length ? roster : previousTopClassRoster)
        : null;
    const interactionRows = systemType === 'topuni'
        && previousTopUniLearnNumber !== null
        ? await client.$queryRaw(client_1.Prisma.sql `
        SELECT
          CAST(chat.user_hmid AS CHAR) AS user_hmid,
          COUNT(*) AS interaction_score
        FROM logs_chat_new AS chat
        WHERE chat.code = ${calendar.code}
          AND chat.learn_number = ${previousTopUniLearnNumber}
        GROUP BY chat.user_hmid
      `)
        : [];
    const interactionByHmid = new Map(interactionRows.map((item) => [String(item.user_hmid), Number(item.interaction_score) || 0]));
    const students = roster.map((student) => {
        const identity = getStudentIdentity(student);
        return {
            id: student.id,
            identity,
            currentRoomId: student.room_id,
            currentClassId: student.class_id,
            preferredRoomId: previousRoomByIdentity.get(identity) ?? student.room_id,
            wasInPreviousSession: previousRoomByIdentity.has(identity),
            recentAttendanceCount: recentAttendance?.counts.get(normalizeUsername(student.username)) ?? null,
            needsCurrentLesson: recentAttendance?.makeupSignalApplied
                ? recentAttendance.needsMakeup.get(normalizeUsername(student.username)) ?? null
                : null,
            interactionScore: interactionByHmid.get(identity) || 0,
        };
    });
    const plan = systemType === 'topuni'
        ? (0, classroom_assignment_algorithm_1.assignTopUniStudents)(students, availableTargets, maxStudentsPerClassroom)
        : (0, classroom_assignment_algorithm_1.assignTopClassStudents)(students, availableTargets);
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
        topClassAttendance: recentAttendance,
        interactionSourceLearnNumber: previousTopUniLearnNumber,
        interactionSourceScores: previousStudentIdentities.map((identity) => interactionByHmid.get(identity) || 0),
        maxStudentsPerClassroom,
    };
};
const buildInteractionResponse = (context) => {
    if (context.calendar.system_type !== 'topuni')
        return null;
    const basedOnRoster = context.plan.assignments.length > 0;
    const scores = basedOnRoster
        ? context.plan.assignments.map((student) => student.interactionScore)
        : context.interactionSourceScores;
    const distribution = scores.reduce((result, score) => {
        result[(0, classroom_assignment_algorithm_1.getTopUniInteractionTier)(score)] += 1;
        return result;
    }, { high: 0, medium: 0, low: 0, none: 0 });
    const interactingScores = scores.filter((score) => score > 0);
    const totalScore = scores.reduce((total, score) => total + score, 0);
    return {
        distribution,
        based_on_roster: basedOnRoster,
        population_students: scores.length,
        interacting_students: interactingScores.length,
        min_room_score: context.plan.summaries.length
            ? Math.min(...context.plan.summaries.map((item) => item.interactionScore))
            : 0,
        max_room_score: context.plan.summaries.length
            ? Math.max(...context.plan.summaries.map((item) => item.interactionScore))
            : 0,
        total_score: totalScore,
        average_score: scores.length ? totalScore / scores.length : 0,
        average_interacting_score: interactingScores.length
            ? totalScore / interactingScores.length
            : 0,
    };
};
const toResponse = (context, operationId) => ({
    operation_id: operationId,
    calendar: context.calendar,
    total_students: context.roster.length,
    classroom_count: context.plan.classroomCount,
    moved_count: context.plan.movedCount,
    max_students_per_classroom: context.maxStudentsPerClassroom,
    attendance: {
        applied: Boolean(context.topClassAttendance),
        based_on_current_roster: context.roster.length > 0,
        population_students: context.topClassAttendance?.populationCount || 0,
        sessions_considered: context.topClassAttendance?.lessonCount || 0,
        lessons_considered: context.topClassAttendance?.lessonCount || 0,
        is_repeat_lesson: context.topClassAttendance?.isRepeatLesson || false,
        prior_occurrence_count: context.topClassAttendance?.priorOccurrenceCount || 0,
        makeup_signal_applied: context.topClassAttendance?.makeupSignalApplied || false,
        already_covered_current_lesson: context.topClassAttendance?.alreadyCoveredCount || 0,
        needs_makeup_current_lesson: context.topClassAttendance?.needsMakeupCount || 0,
        distribution: context.topClassAttendance && context.topClassAttendance.lessonCount > 0
            ? context.topClassAttendance.distribution
            : null,
    },
    interaction: buildInteractionResponse(context),
    interaction_source: context.calendar.system_type === 'topuni'
        ? {
            learn_number: context.interactionSourceLearnNumber,
        }
        : null,
    continuity: context.calendar.system_type === 'topuni'
        ? (() => {
            const existingStudents = context.plan.assignments.filter((student) => student.wasInPreviousSession);
            const retainedStudents = existingStudents.filter((student) => student.targetRoomId === student.preferredRoomId);
            return {
                existing_students: existingStudents.length,
                new_students: context.plan.assignments.length - existingStudents.length,
                retained_existing_students: retainedStudents.length,
                moved_existing_students: existingStudents.length - retainedStudents.length,
            };
        })()
        : null,
    classrooms: context.plan.summaries,
    assignments: context.plan.assignments.map((assignment) => ({
        user_id: assignment.id,
        identity: assignment.identity,
        previous_room_id: assignment.currentRoomId,
        new_room_id: assignment.targetRoomId,
        previous_class_id: assignment.currentClassId,
        new_class_id: assignment.targetClassId,
        interaction_score: assignment.interactionScore,
        interaction_tier: assignment.interactionTier,
        was_in_previous_session: Boolean(assignment.wasInPreviousSession),
        preferred_room_id: assignment.preferredRoomId,
        recent_attendance_count: assignment.recentAttendanceCount,
        needs_current_lesson: assignment.needsCurrentLesson,
        changed: assignment.currentClassId !== assignment.targetClassId,
    })),
});
const previewClassroomAssignment = async (calendarId, options = {}) => (toResponse(await loadAssignmentContext(prisma_1.default, calendarId, options)));
exports.previewClassroomAssignment = previewClassroomAssignment;
const applyClassroomAssignment = async (calendarId, _actor = {}, options = {}) => prisma_1.default.$transaction(async (tx) => {
    // Rebuild inside the transaction so apply never commits a stale preview.
    const context = await loadAssignmentContext(tx, calendarId, options);
    const changes = context.plan.assignments.filter((assignment) => assignment.currentRoomId !== assignment.targetRoomId
        || assignment.currentClassId !== assignment.targetClassId);
    if (!changes.length)
        return toResponse(context);
    // Tạm thời không ghi audit vào classroom_assignment_history vì database
    // hiện tại chưa có bảng này. Phân lớp vẫn dùng users.room_id/class_id.
    const changesByClass = new Map();
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
        throw new Error(`Roster đã thay đổi trong lúc phân lớp: dự kiến ${changes.length}, cập nhật ${updatedCount}`);
    }
    return toResponse(context);
}, {
    isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
    timeout: 30_000,
});
exports.applyClassroomAssignment = applyClassroomAssignment;
