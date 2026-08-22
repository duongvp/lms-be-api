import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignTopClassStudents,
  assignTopUniStudents,
  ClassroomAssignmentStudent,
  getBalancedCapacities,
} from '../src/modules/livestream/classroom-assignment.algorithm';

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

for (const count of [1, 14, 15, 16, 29, 30, 31, 78, 79, 80, 81, 89, 90, 150]) {
  test(`TopClass chia đều ${count} học sinh và không lớp nào quá 15`, () => {
    const result = assignTopClassStudents(buildStudents(count), classroomTargets);
    const sizes = result.summaries.map((summary) => summary.studentCount);
    assert.equal(result.classroomCount, Math.ceil(count / 15));
    assert.equal(sizes.reduce((total, size) => total + size, 0), count);
    assert.ok(sizes.every((size) => size <= 15));
    assertBalancedSizes(sizes);
  });
}

test('TopClass giữ nguyên tối đa học sinh đang ở classroom hợp lệ', () => {
  const students = buildStudents(
    31,
    () => 0,
    (index) => index < 11 ? 1 : index < 21 ? 2 : 3
  );
  const result = assignTopClassStudents(students, classroomTargets);
  assert.equal(result.movedCount, 0);
  assert.deepEqual(result.summaries.map((item) => item.studentCount), [11, 10, 10]);
});

test('room_id và hậu tố class_id luôn đồng bộ, room hợp lệ được giữ nguyên', () => {
  const students = buildStudents(16, () => 0, (index) => index < 8 ? 1 : 2);
  students[8].currentClassId = 'CLASS-1';
  const result = assignTopClassStudents(students, classroomTargets);
  const corrected = result.assignments.find((item) => item.id === students[8].id);

  assert.equal(corrected?.targetRoomId, 2);
  assert.equal(corrected?.targetClassId, 'CLASS-2');
  assert.ok(result.assignments.every(
    (item) => item.targetClassId.endsWith(String(item.targetRoomId))
  ));
});

test('TopClass khi giảm số lớp chỉ chuyển học sinh của lớp bị thu hồi hoặc bị vượt capacity', () => {
  const students = buildStudents(78, () => 0, (index) => Math.floor(index / 15) + 1);
  const result = assignTopClassStudents(students, classroomTargets);
  assert.equal(result.classroomCount, 6);
  assertBalancedSizes(result.summaries.map((item) => item.studentCount));
  assert.ok(result.assignments.every((item) => Number(item.targetClassId.split('-')[1]) <= 6));
});

test('TopUni 900 học sinh cân bằng cả số lượng và tổng interaction score', () => {
  const result = assignTopUniStudents(
    buildStudents(900, (index) => 900 - index, () => null),
    classroomTargets
  );
  const sizes = result.summaries.map((summary) => summary.studentCount);
  const scores = result.summaries.map((summary) => summary.interactionScore);
  assert.deepEqual(sizes, [225, 225, 225, 225]);
  // Tổng 1..900 không chia hết tuyệt đối cho 4; greedy vẫn giữ chênh lệch
  // chỉ 3 điểm trên hơn 400 nghìn điểm tương tác.
  assert.ok(Math.max(...scores) - Math.min(...scores) <= 4, `scores=${scores.join(',')}`);
});

test('TopUni 800 học sinh có score bằng nhau vẫn chia đều và deterministic', () => {
  const students = buildStudents(800, () => 5, () => null);
  const first = assignTopUniStudents(students, classroomTargets);
  const second = assignTopUniStudents(students, classroomTargets);
  assert.deepEqual(first.assignments, second.assignments);
  assert.deepEqual(first.summaries.map((item) => item.studentCount), [200, 200, 200, 200]);
  assert.deepEqual(first.summaries.map((item) => item.interactionScore), [1000, 1000, 1000, 1000]);
});

test('TopUni dàn đều nhóm tương tác rất cao và user không có chat có score 0', () => {
  const students = buildStudents(800, (index) => index < 8 ? 10_000 : 0, () => null);
  const result = assignTopUniStudents(students, classroomTargets);
  assert.deepEqual(result.summaries.map((item) => item.studentCount), [200, 200, 200, 200]);
  assert.deepEqual(result.summaries.map((item) => item.interactionScore), [20_000, 20_000, 20_000, 20_000]);
});

test('không âm thầm tạo classroom nếu stream chưa cấu hình đủ', () => {
  assert.throws(
    () => assignTopUniStudents(buildStudents(10), [classroomTargets[0]]),
    /cần 4 classroom/
  );
  assert.throws(
    () => assignTopClassStudents(buildStudents(31), classroomTargets.slice(0, 2)),
    /cần 3 classroom/
  );
});
