export type ClassroomSystemType = 'topclass' | 'topuni';

export type ClassroomAssignmentStudent = {
  id: number;
  identity: string;
  currentRoomId: number | null;
  currentClassId: string | null;
  interactionScore: number;
};

export type ClassroomTarget = {
  roomId: number;
  classId: string;
};

export type ClassroomAssignment = ClassroomAssignmentStudent & {
  targetRoomId: number;
  targetClassId: string;
  classroomIndex: number;
};

export type ClassroomSummary = {
  roomId: number;
  classId: string;
  classroomIndex: number;
  studentCount: number;
  interactionScore: number;
};

export type ClassroomAssignmentPlan = {
  systemType: ClassroomSystemType;
  classroomCount: number;
  assignments: ClassroomAssignment[];
  summaries: ClassroomSummary[];
  movedCount: number;
};

const compareStudents = (left: ClassroomAssignmentStudent, right: ClassroomAssignmentStudent) => (
  left.identity.localeCompare(right.identity, 'en', { numeric: true }) || left.id - right.id
);

const buildResult = (
  systemType: ClassroomSystemType,
  targets: ClassroomTarget[],
  assignments: ClassroomAssignment[]
): ClassroomAssignmentPlan => {
  const summaries = targets.map((target, index) => {
    const students = assignments.filter((assignment) => assignment.targetRoomId === target.roomId);
    return {
      roomId: target.roomId,
      classId: target.classId,
      classroomIndex: index + 1,
      studentCount: students.length,
      interactionScore: students.reduce((total, student) => total + student.interactionScore, 0),
    };
  });

  return {
    systemType,
    classroomCount: targets.length,
    assignments: assignments.sort((left, right) => compareStudents(left, right)),
    summaries,
    movedCount: assignments.filter(
      (assignment) => assignment.currentRoomId !== assignment.targetRoomId
        || assignment.currentClassId !== assignment.targetClassId
    ).length,
  };
};

export const getBalancedCapacities = (studentCount: number, classroomCount: number) => {
  if (!Number.isInteger(studentCount) || studentCount < 0) {
    throw new Error('Số học sinh không hợp lệ');
  }
  if (!Number.isInteger(classroomCount) || classroomCount <= 0) {
    return [];
  }

  const baseSize = Math.floor(studentCount / classroomCount);
  const remainder = studentCount % classroomCount;
  return Array.from(
    { length: classroomCount },
    (_, index) => baseSize + (index < remainder ? 1 : 0)
  );
};

/**
 * TopClass ưu tiên giữ học sinh ở classroom hiện tại. Chỉ học sinh ở classroom
 * đã bị thu hồi hoặc phần vượt capacity mới được chuyển sang classroom khác.
 */
export const assignTopClassStudents = (
  students: ClassroomAssignmentStudent[],
  availableTargets: ClassroomTarget[]
): ClassroomAssignmentPlan => {
  if (!students.length) return buildResult('topclass', [], []);

  const classroomCount = Math.ceil(students.length / 15);
  if (availableTargets.length < classroomCount) {
    throw new Error(
      `TopClass cần ${classroomCount} classroom nhưng hiện chỉ cấu hình ${availableTargets.length}`
    );
  }

  const targets = availableTargets.slice(0, classroomCount);
  const capacities = getBalancedCapacities(students.length, classroomCount);
  const assignments: ClassroomAssignment[] = [];
  const pending: ClassroomAssignmentStudent[] = [];

  targets.forEach((target, index) => {
    const currentStudents = students
      .filter((student) => student.currentRoomId === target.roomId)
      .sort(compareStudents);
    const keptStudents = currentStudents.slice(0, capacities[index]);
    const overflowStudents = currentStudents.slice(capacities[index]);

    assignments.push(...keptStudents.map((student) => ({
      ...student,
      targetRoomId: target.roomId,
      targetClassId: target.classId,
      classroomIndex: index + 1,
    })));
    pending.push(...overflowStudents);
  });

  const validRoomIds = new Set(targets.map((target) => target.roomId));
  pending.push(...students.filter(
    (student) => student.currentRoomId === null || !validRoomIds.has(student.currentRoomId)
  ));
  pending.sort(compareStudents);

  targets.forEach((target, index) => {
    const occupied = assignments.filter((assignment) => assignment.targetRoomId === target.roomId).length;
    const missing = capacities[index] - occupied;
    const selected = pending.splice(0, missing);
    assignments.push(...selected.map((student) => ({
      ...student,
      targetRoomId: target.roomId,
      targetClassId: target.classId,
      classroomIndex: index + 1,
    })));
  });

  return buildResult('topclass', targets, assignments);
};

/**
 * TopUni dùng greedy LPT: học sinh tương tác cao được xử lý trước và luôn đưa
 * vào classroom có tổng score thấp nhất còn capacity. Khi các tổng bằng nhau,
 * classroom hiện tại được ưu tiên để giảm số học sinh phải chuyển lớp.
 */
export const assignTopUniStudents = (
  students: ClassroomAssignmentStudent[],
  availableTargets: ClassroomTarget[]
): ClassroomAssignmentPlan => {
  if (!students.length) return buildResult('topuni', [], []);

  const classroomCount = 4;
  if (availableTargets.length < classroomCount) {
    throw new Error(
      `TopUni cần ${classroomCount} classroom nhưng hiện chỉ cấu hình ${availableTargets.length}`
    );
  }

  const targets = availableTargets.slice(0, classroomCount);
  const capacities = getBalancedCapacities(students.length, classroomCount);
  const buckets = targets.map((target, index) => ({
    roomId: target.roomId,
    classId: target.classId,
    classroomIndex: index + 1,
    capacity: capacities[index],
    interactionScore: 0,
    students: [] as ClassroomAssignmentStudent[],
  }));

  const orderedStudents = [...students].sort((left, right) => (
    right.interactionScore - left.interactionScore || compareStudents(left, right)
  ));

  orderedStudents.forEach((student) => {
    const candidates = buckets
      .filter((bucket) => bucket.students.length < bucket.capacity)
      .sort((left, right) => (
        left.interactionScore - right.interactionScore
        || Number(right.roomId === student.currentRoomId) - Number(left.roomId === student.currentRoomId)
        || left.students.length - right.students.length
        || left.classroomIndex - right.classroomIndex
      ));
    const target = candidates[0];
    if (!target) throw new Error('Không tìm được classroom còn capacity');
    target.students.push(student);
    target.interactionScore += student.interactionScore;
  });

  const assignments = buckets.flatMap((bucket) => bucket.students.map((student) => ({
    ...student,
    targetRoomId: bucket.roomId,
    targetClassId: bucket.classId,
    classroomIndex: bucket.classroomIndex,
  })));

  return buildResult('topuni', targets, assignments);
};
