import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignTopClassStudents,
  assignTopUniStudents,
  ClassroomAssignmentStudent,
  getTopUniInteractionTier,
  getBalancedCapacities,
} from '../src/modules/livestream/classroom-assignment.algorithm';
import {
  buildClassroomAssignmentHistoryRows,
  normalizeClassroomAssignmentId,
  summarizeTopClassLessonAttendance,
} from '../src/modules/livestream/classroom-assignment.service';

test('chuẩn hóa users.id BigInt từ raw query trước khi gọi Prisma updateMany', () => {
  assert.equal(normalizeClassroomAssignmentId(1206044n), 1206044);
  assert.equal(normalizeClassroomAssignmentId(3), 3);
  assert.throws(() => normalizeClassroomAssignmentId(0n), /users\.id không hợp lệ/);
});

test('audit lưu snapshot đầy đủ cho cả học sinh giữ nguyên và học sinh chuyển phòng', () => {
  const rows = buildClassroomAssignmentHistoryRows({
    calendar: {
      id: 1415,
      code: 'toan-6-2027',
      learn_number: 20,
      system_type: 'topclass',
      start_time: new Date('2026-09-03T10:00:00.000Z'),
    },
    roster: [
      { id: 1, username: 'student-1', student_hmid: null, name: 'Học sinh 1', room_id: 1, class_id: 'OLD-1' },
      { id: 2, username: 'student-2', student_hmid: null, name: 'Học sinh 2', room_id: 2, class_id: 'NEW-2' },
    ],
    plan: {
      classroomCount: 2,
      movedCount: 1,
      summaries: [],
      assignments: [
        { id: 1, identity: 'student-1', currentRoomId: 1, currentClassId: 'OLD-1', targetRoomId: 2, targetClassId: 'NEW-2', interactionScore: 3 },
        { id: 2, identity: 'student-2', currentRoomId: 2, currentClassId: 'NEW-2', targetRoomId: 2, targetClassId: 'NEW-2', interactionScore: 0 },
      ],
    },
    topClassAttendance: null,
    interactionSourceLearnNumber: null,
    interactionSourceScores: [],
    maxStudentsPerClassroom: null,
  }, '11111111-1111-4111-8111-111111111111', { username: 'admin' });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    operation_id: '11111111-1111-4111-8111-111111111111',
    calendar_id: 1415,
    user_id: 1,
    username: 'student-1',
    code: 'toan-6-2027',
    learn_number: 20,
    system_type: 'topclass',
    previous_room_id: 1,
    new_room_id: 2,
    previous_class_id: 'OLD-1',
    new_class_id: 'NEW-2',
    interaction_score: 3,
    created_by: 'admin',
  });
  assert.equal(rows[1].previous_room_id, rows[1].new_room_id);
  assert.equal(rows[1].previous_class_id, rows[1].new_class_id);
});

const classroomTargets = Array.from({ length: 80 }, (_, index) => ({
  roomId: index + 1,
  classId: `CLASS-${index + 1}`,
}));

const buildStudents = (
  count: number,
  getScore: (index: number) => number = () => 0,
  getRoomId: (index: number) => number | null = () => 1
): ClassroomAssignmentStudent[] => Array.from({ length: count }, (_, index) => ({
  id: index + 1,
  identity: String(100_000 + index),
  currentRoomId: getRoomId(index),
  currentClassId: getRoomId(index) === null ? null : `CLASS-${getRoomId(index)}`,
  interactionScore: getScore(index),
}));

const assertBalancedSizes = (sizes: number[]) => {
  if (!sizes.length) return;
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `sizes=${sizes.join(',')}`);
};

test('capacity luôn chia đều phần dư vào các lớp đầu', () => {
  assert.deepEqual(getBalancedCapacities(78, 6), [13, 13, 13, 13, 13, 13]);
  assert.deepEqual(getBalancedCapacities(79, 6), [14, 13, 13, 13, 13, 13]);
  assert.deepEqual(getBalancedCapacities(80, 6), [14, 14, 13, 13, 13, 13]);
  assert.deepEqual(getBalancedCapacities(81, 6), [14, 14, 14, 13, 13, 13]);
});

for (const count of [1, 19, 20, 21, 39, 40, 41, 78, 79, 80, 81, 99, 100, 150]) {
  test(`TopClass chia đều ${count} học sinh và không lớp nào quá 20`, () => {
    const result = assignTopClassStudents(buildStudents(count), classroomTargets);
    const sizes = result.summaries.map((summary) => summary.studentCount);
    assert.equal(result.classroomCount, Math.ceil(count / 20));
    assert.equal(sizes.reduce((total, size) => total + size, 0), count);
    assert.ok(sizes.every((size) => size <= 20));
    assertBalancedSizes(sizes);
  });
}

test('TopClass giữ nguyên tối đa học sinh đang ở classroom hợp lệ', () => {
  const students = buildStudents(
    31,
    () => 0,
    (index) => index < 11 ? 1 : index < 21 ? 2 : 3
  );
  const result = assignTopClassStudents(students, classroomTargets, 3);
  assert.equal(result.movedCount, 0);
  assert.deepEqual(result.summaries.map((item) => item.studentCount), [11, 10, 10]);
});

test('TopClass ưu tiên giữ nhóm học sinh theo phòng của buổi trước', () => {
  const students = Array.from({ length: 36 }, (_, index) => ({
    id: index + 1,
    identity: String(900_000 + index),
    // Enrollment buổi mới đều khởi tạo ở room 1.
    currentRoomId: 1,
    currentClassId: 'NEXT-1',
    // Lịch sử buổi trước đã chia đều thành ba nhóm 12 học sinh.
    preferredRoomId: Math.floor(index / 12) + 1,
    interactionScore: 0,
  }));
  const targets = [1, 2, 3].map((roomId) => ({
    roomId,
    classId: `NEXT-${roomId}`,
  }));

  const result = assignTopClassStudents(students, targets, 3);

  assert.deepEqual(result.summaries.map((item) => item.studentCount), [12, 12, 12]);
  assert.ok(result.assignments.every(
    (assignment) => assignment.targetRoomId === assignment.preferredRoomId
  ));
  // currentRoomId vẫn là trạng thái thật để apply biết 24 row cần cập nhật.
  assert.equal(result.movedCount, 24);
});

test('TopClass giữ số phòng buổi trước khi mỗi phòng vẫn không quá 20 học sinh', () => {
  const students = buildStudents(31, () => 0, (index) => index < 16 ? 1 : 2);
  const result = assignTopClassStudents(students, classroomTargets, 2);

  assert.equal(result.classroomCount, 2);
  assert.deepEqual(result.summaries.map((item) => item.studentCount), [16, 15]);
});

test('TopClass tự tăng phòng khi số phòng buổi trước không đủ giới hạn 20 học sinh', () => {
  const result = assignTopClassStudents(buildStudents(304), classroomTargets, 14);

  assert.equal(result.classroomCount, 16);
  assert.deepEqual(result.summaries.map((item) => item.studentCount), Array(16).fill(19));
});

test('TopClass dàn đều học sinh có chuyên cần và vẫn giữ sĩ số cân bằng', () => {
  const students = Array.from({ length: 36 }, (_, index) => ({
    id: index + 1,
    identity: String(910_000 + index),
    currentRoomId: Math.floor(index / 12) + 1,
    currentClassId: `CLASS-${Math.floor(index / 12) + 1}`,
    preferredRoomId: Math.floor(index / 12) + 1,
    // Phòng 1 cũ có toàn bộ học sinh chuyên cần; phòng 2 và 3 có nhóm nghỉ 3/3.
    recentAttendanceCount: index < 12 ? 3 : index < 24 ? 2 : 0,
    interactionScore: 0,
  }));
  const targets = [1, 2, 3].map((roomId) => ({ roomId, classId: `CLASS-${roomId}` }));

  const result = assignTopClassStudents(students, targets, 3);
  const attendanceScores = result.summaries.map((summary) => (
    result.assignments
      .filter((student) => student.targetRoomId === summary.roomId)
      .reduce((total, student) => total + Number(student.recentAttendanceCount), 0)
  ));

  assert.deepEqual(result.summaries.map((item) => item.studentCount), [12, 12, 12]);
  assert.ok(Math.max(...attendanceScores) - Math.min(...attendanceScores) <= 1);
  assert.deepEqual(result.summaries.map((item) => item.expectedAttendeeCount), [8, 8, 8]);
  assert.ok(result.movedCount > 0);
});

test('TopClass chỉ hoán đổi tối thiểu khi một phòng có 6 học sinh nghỉ cả 3 buổi', () => {
  const students = Array.from({ length: 36 }, (_, index) => {
    const roomId = Math.floor(index / 12) + 1;
    return {
      id: index + 1,
      identity: `HS${String(index + 1).padStart(2, '0')}`,
      currentRoomId: roomId,
      currentClassId: `CLASS-${roomId}`,
      preferredRoomId: roomId,
      recentAttendanceCount: index < 6 ? 0 : 3,
      interactionScore: 0,
    };
  });
  const targets = [1, 2, 3].map((roomId) => ({ roomId, classId: `CLASS-${roomId}` }));

  const result = assignTopClassStudents(students, targets, 3);

  assert.deepEqual(result.summaries.map((item) => item.studentCount), [12, 12, 12]);
  assert.deepEqual(result.summaries.map((item) => item.expectedAttendeeCount), [10, 10, 10]);
  assert.deepEqual(result.summaries.map((item) => item.attendanceBreakdown?.[0]), [2, 2, 2]);
  // Chỉ cần đổi chéo 4 cặp (8 học sinh), 28/36 học sinh vẫn ở cùng nhóm cũ.
  assert.equal(result.movedCount, 8);
});

test('TopClass lần học bổ sung cân bằng học sinh chưa học nội dung giữa các phòng', () => {
  const students = Array.from({ length: 36 }, (_, index) => {
    const roomId = Math.floor(index / 12) + 1;
    return {
      id: index + 1,
      identity: `MAKEUP-${index + 1}`,
      currentRoomId: roomId,
      currentClassId: `CLASS-${roomId}`,
      preferredRoomId: roomId,
      recentAttendanceCount: index % 4,
      // Toàn bộ 12 học sinh cần học bổ sung ban đầu đang ở phòng 1.
      needsCurrentLesson: index < 12,
      interactionScore: 0,
    };
  });
  const targets = [1, 2, 3].map((roomId) => ({ roomId, classId: `CLASS-${roomId}` }));

  const result = assignTopClassStudents(students, targets, 3);

  assert.deepEqual(result.summaries.map((item) => item.studentCount), [12, 12, 12]);
  assert.deepEqual(result.summaries.map((item) => item.needsMakeupCount), [4, 4, 4]);
  assert.deepEqual(result.summaries.map((item) => item.expectedAttendeeCount), [4, 4, 4]);
  assert.equal(result.movedCount, 16);
});

test('TopClass gộp nhiều lần học cùng nội dung và chỉ tính học sinh một lần', () => {
  const signal = summarizeTopClassLessonAttendance([
    { username: 'hs-a', attendance_minutes: 5 },
    { username: 'HS-A', attendance_minutes: 10 },
    { username: 'hs-b', attendance_minutes: 4 },
  ]);

  assert.equal(signal.usable, true);
  assert.deepEqual([...signal.attended], ['hs-a']);
});

test('TopClass không dùng chuyên cần nếu roster còn dữ liệu null', () => {
  const students = buildStudents(30, () => 0, (index) => index < 15 ? 1 : 2);
  students.forEach((student, index) => {
    student.preferredRoomId = student.currentRoomId;
    student.recentAttendanceCount = index === 0 ? null : index % 4;
  });

  const result = assignTopClassStudents(students, classroomTargets, 2);
  assert.equal(result.movedCount, 0);
});

test('room_id và hậu tố class_id luôn đồng bộ, room hợp lệ được giữ nguyên', () => {
  const students = buildStudents(16, () => 0, (index) => index < 8 ? 1 : 2);
  students[8].currentClassId = 'CLASS-1';
  const result = assignTopClassStudents(students, classroomTargets, 2);
  const corrected = result.assignments.find((item) => item.id === students[8].id);

  assert.equal(corrected?.targetRoomId, 2);
  assert.equal(corrected?.targetClassId, 'CLASS-2');
  assert.ok(result.assignments.every(
    (item) => item.targetClassId.endsWith(String(item.targetRoomId))
  ));
});

test('TopClass cấp room_id và class_id mới cho học sinh chưa được phân lớp', () => {
  const students = buildStudents(21, () => 0, () => null);
  const result = assignTopClassStudents(students, classroomTargets);

  assert.equal(result.classroomCount, 2);
  assert.ok(result.assignments.every((item) => item.targetRoomId > 0));
  assert.ok(result.assignments.every(
    (item) => item.targetClassId === `CLASS-${item.targetRoomId}`
  ));
});

test('TopClass khi giảm số lớp chỉ chuyển học sinh của lớp bị thu hồi hoặc bị vượt capacity', () => {
  const students = buildStudents(78, () => 0, (index) => Math.floor(index / 15) + 1);
  const result = assignTopClassStudents(students, classroomTargets);
  assert.equal(result.classroomCount, 4);
  assertBalancedSizes(result.summaries.map((item) => item.studentCount));
  assert.ok(result.assignments.every((item) => Number(item.targetClassId.split('-')[1]) <= 4));
});

test('TopUni 900 học sinh cân bằng cả số lượng và tổng interaction score', () => {
  const result = assignTopUniStudents(
    buildStudents(900, (index) => 900 - index, () => null),
    classroomTargets,
    225
  );
  const sizes = result.summaries.map((summary) => summary.studentCount);
  const scores = result.summaries.map((summary) => summary.interactionScore);
  assert.deepEqual(sizes, [225, 225, 225, 225]);
  // Sau khi quota bốn nhóm đã cân bằng, greedy tiếp tục dàn điểm trong từng
  // nhóm. Chênh vài điểm trên hơn 100 nghìn điểm/phòng là không đáng kể.
  assert.ok(Math.max(...scores) - Math.min(...scores) <= 8, `scores=${scores.join(',')}`);
});

test('TopUni phân nhóm theo ngưỡng tương tác cố định', () => {
  assert.equal(getTopUniInteractionTier(8), 'high');
  assert.equal(getTopUniInteractionTier(7), 'medium');
  assert.equal(getTopUniInteractionTier(4), 'medium');
  assert.equal(getTopUniInteractionTier(3), 'low');
  assert.equal(getTopUniInteractionTier(2), 'low');
  assert.equal(getTopUniInteractionTier(1), 'low');
  assert.equal(getTopUniInteractionTier(0), 'none');
});

test('TopUni giữ số phòng buổi trước khi giới hạn mỗi phòng được tính ngược', () => {
  const result = assignTopUniStudents(
    buildStudents(10, () => 0, () => null),
    classroomTargets,
    2,
    6
  );

  assert.equal(result.classroomCount, 6);
  assert.deepEqual(result.summaries.map((item) => item.studentCount), [2, 2, 2, 2, 1, 1]);
});

test('TopUni xử lý roster lớn 8.559 học sinh mà vẫn giữ sĩ số cân bằng', { timeout: 5_000 }, () => {
  const result = assignTopUniStudents(
    buildStudents(8_559, (index) => index < 1_772 ? 100 - (index % 100) : 0, () => null),
    classroomTargets
  );

  assert.equal(result.classroomCount, 18);
  assert.deepEqual(
    result.summaries.map((item) => item.studentCount),
    [...Array(9).fill(476), ...Array(9).fill(475)]
  );
  assert.equal(result.assignments.length, 8_559);
  assertBalancedSizes(result.summaries.map((item) => item.studentCount));
  assert.ok(result.summaries.every((item) => item.studentCount <= 500));
});

test('TopUni tăng số phòng khi vượt ngưỡng 500 học sinh/phòng', () => {
  const exactlyTwoThousand = assignTopUniStudents(buildStudents(2_000), classroomTargets);
  const overTwoThousand = assignTopUniStudents(buildStudents(2_001), classroomTargets);

  assert.deepEqual(exactlyTwoThousand.summaries.map((item) => item.studentCount), [500, 500, 500, 500]);
  assert.equal(overTwoThousand.classroomCount, 5);
  assert.deepEqual(overTwoThousand.summaries.map((item) => item.studentCount), [401, 400, 400, 400, 400]);
});

test('TopUni không ép tối thiểu 4 phòng mà tính hoàn toàn theo giới hạn sĩ số', () => {
  assert.equal(assignTopUniStudents(buildStudents(499), classroomTargets).classroomCount, 1);
  assert.equal(assignTopUniStudents(buildStudents(500), classroomTargets).classroomCount, 1);
  assert.equal(assignTopUniStudents(buildStudents(501), classroomTargets).classroomCount, 2);
});

test('TopUni cho phép cấu hình số học sinh tối đa mỗi phòng', () => {
  const result = assignTopUniStudents(buildStudents(800), classroomTargets, 200);

  assert.equal(result.classroomCount, 4);
  assert.deepEqual(result.summaries.map((item) => item.studentCount), [200, 200, 200, 200]);
  assert.throws(
    () => assignTopUniStudents(buildStudents(801), classroomTargets.slice(0, 4), 200),
    /cần 5 classroom.*tối đa 200 học sinh\/phòng.*ít nhất 201 học sinh\/phòng/
  );
});

test('TopUni 800 học sinh có score bằng nhau vẫn chia đều và deterministic', () => {
  const students = buildStudents(800, () => 5, () => null);
  const first = assignTopUniStudents(students, classroomTargets, 200);
  const second = assignTopUniStudents(students, classroomTargets, 200);
  assert.deepEqual(first.assignments, second.assignments);
  assert.deepEqual(first.summaries.map((item) => item.studentCount), [200, 200, 200, 200]);
  assert.deepEqual(first.summaries.map((item) => item.interactionScore), [1000, 1000, 1000, 1000]);
});

test('TopUni dàn đều nhóm tương tác rất cao và user không có chat có score 0', () => {
  const students = buildStudents(800, (index) => index < 8 ? 10_000 : 0, () => null);
  const result = assignTopUniStudents(students, classroomTargets, 200);
  assert.deepEqual(result.summaries.map((item) => item.studentCount), [200, 200, 200, 200]);
  assert.deepEqual(result.summaries.map((item) => item.interactionScore), [20_000, 20_000, 20_000, 20_000]);
});

test('TopUni giữ tỷ lệ cao, trung bình, thấp và không tương tác cân bằng giữa 4 phòng', () => {
  const students = buildStudents(
    40,
    (index) => index < 8 ? 8 : index < 16 ? 5 : index < 24 ? 1 : 0,
    () => null
  );

  const result = assignTopUniStudents(students, classroomTargets, 10);

  assert.deepEqual(result.summaries.map((item) => item.studentCount), [10, 10, 10, 10]);
  assert.ok(result.summaries.every((item) => (
    item.interactionBreakdown?.high === 2
    && item.interactionBreakdown.medium === 2
    && item.interactionBreakdown.low === 2
    && item.interactionBreakdown.none === 4
  )));
  assert.deepEqual(result.summaries.map((item) => item.interactionScore), [28, 28, 28, 28]);
});

test('TopUni giữ học sinh cũ ở room buổi trước và chỉ phân bổ học sinh mới', () => {
  const oldStudents = buildStudents(12, (index) => index % 3 === 0 ? 8 : index % 3 === 1 ? 5 : 1, (index) => Math.floor(index / 3) + 1)
    .map((student) => ({
      ...student,
      preferredRoomId: student.currentRoomId,
      wasInPreviousSession: true,
    }));
  const newStudents = buildStudents(4, (index) => [8, 5, 1, 0][index], () => null)
    .map((student, index) => ({ ...student, id: 100 + index, identity: `NEW-${index}` }));

  const result = assignTopUniStudents([...oldStudents, ...newStudents], classroomTargets, 4);

  assert.deepEqual(result.summaries.map((item) => item.studentCount), [4, 4, 4, 4]);
  assert.ok(result.assignments
    .filter((student) => student.wasInPreviousSession)
    .every((student) => student.targetRoomId === student.preferredRoomId));
  assert.equal(result.assignments.filter((student) => !student.wasInPreviousSession).length, 4);
});

test('TopUni chỉ chuyển học sinh cũ khi room trước vượt quota nhóm tương tác', () => {
  const students = buildStudents(
    40,
    (index) => index < 8 ? 8 : index < 16 ? 5 : 1,
    (index) => Math.floor(index / 10) + 1
  ).map((student) => ({
    ...student,
    preferredRoomId: student.currentRoomId,
    wasInPreviousSession: true,
  }));

  const result = assignTopUniStudents(students, classroomTargets, 10);

  assert.ok(result.summaries.every((item) => (
    item.interactionBreakdown?.high === 2
    && item.interactionBreakdown.medium === 2
    && item.interactionBreakdown.low === 6
    && item.interactionBreakdown.none === 0
  )));
  // Số giữ tối đa theo quota: room 1 giữ 4, room 2 giữ 6, room 3 và 4 mỗi
  // room giữ 6. Vì vậy tối thiểu phải chuyển 40 - (4 + 6 + 6 + 6) = 18 em.
  assert.equal(result.movedCount, 18);
});

test('thuật toán báo lỗi nếu caller truyền thiếu classroom mục tiêu', () => {
  assert.throws(
    () => assignTopUniStudents(buildStudents(10), [classroomTargets[0]], 5),
    /cần 2 classroom/
  );
  assert.throws(
    () => assignTopClassStudents(buildStudents(41), classroomTargets.slice(0, 2)),
    /cần 3 classroom/
  );
});
