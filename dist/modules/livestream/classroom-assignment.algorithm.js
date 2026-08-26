"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignTopUniStudents = exports.getTopUniInteractionTier = exports.assignTopClassStudents = exports.getBalancedCapacities = exports.TOPUNI_MAX_STUDENTS_PER_CLASSROOM = void 0;
exports.TOPUNI_MAX_STUDENTS_PER_CLASSROOM = 500;
const compareStudents = (left, right) => (left.identity.localeCompare(right.identity, 'en', { numeric: true }) || left.id - right.id);
const getPreferredTopClassRoomId = (student) => (student.preferredRoomId ?? student.currentRoomId);
const buildResult = (systemType, targets, assignments) => {
    const summaries = targets.map((target, index) => {
        const students = assignments.filter((assignment) => assignment.targetRoomId === target.roomId);
        const hasAttendance = students.every((student) => Number.isInteger(student.recentAttendanceCount));
        const hasMakeupSignal = assignments.every((student) => typeof student.needsCurrentLesson === 'boolean');
        const isExpected = (student) => (hasMakeupSignal
            ? student.needsCurrentLesson === true
            : Number(student.recentAttendanceCount) > 0);
        const previousStudents = assignments.filter((assignment) => getPreferredTopClassRoomId(assignment) === target.roomId);
        const currentStudents = assignments.filter((assignment) => systemType === 'topuni'
            ? assignment.wasInPreviousSession && assignment.preferredRoomId === target.roomId
            : assignment.currentRoomId === target.roomId);
        return {
            roomId: target.roomId,
            classId: target.classId,
            classroomIndex: index + 1,
            studentCount: students.length,
            interactionScore: students.reduce((total, student) => total + student.interactionScore, 0),
            previousInteractionScore: systemType === 'topuni'
                ? currentStudents.reduce((total, student) => total + student.interactionScore, 0)
                : null,
            expectedAttendeeCount: hasAttendance
                ? students.filter(isExpected).length
                : null,
            previousExpectedAttendeeCount: hasAttendance
                ? previousStudents.filter(isExpected).length
                : null,
            needsMakeupCount: hasMakeupSignal
                ? students.filter((student) => student.needsCurrentLesson === true).length
                : null,
            previousNeedsMakeupCount: hasMakeupSignal
                ? previousStudents.filter((student) => student.needsCurrentLesson === true).length
                : null,
            attendanceBreakdown: hasAttendance
                ? students.reduce((result, student) => {
                    const count = Number(student.recentAttendanceCount);
                    result[count] += 1;
                    return result;
                }, { 0: 0, 1: 0, 2: 0, 3: 0 })
                : null,
            interactionBreakdown: systemType === 'topuni'
                ? students.reduce((result, student) => {
                    result[student.interactionTier || 'none'] += 1;
                    return result;
                }, { high: 0, medium: 0, low: 0, none: 0 })
                : null,
        };
    });
    return {
        systemType,
        classroomCount: targets.length,
        assignments: assignments.sort((left, right) => compareStudents(left, right)),
        summaries,
        movedCount: assignments.filter((assignment) => assignment.currentRoomId !== assignment.targetRoomId
            || assignment.currentClassId !== assignment.targetClassId).length,
    };
};
const getBalancedCapacities = (studentCount, classroomCount) => {
    if (!Number.isInteger(studentCount) || studentCount < 0) {
        throw new Error('Số học sinh không hợp lệ');
    }
    if (!Number.isInteger(classroomCount) || classroomCount <= 0) {
        return [];
    }
    const baseSize = Math.floor(studentCount / classroomCount);
    const remainder = studentCount % classroomCount;
    return Array.from({ length: classroomCount }, (_, index) => baseSize + (index < remainder ? 1 : 0));
};
exports.getBalancedCapacities = getBalancedCapacities;
/**
 * TopClass cân bằng theo tối đa 3 nội dung gần nhất, mỗi nội dung chỉ tính một
 * lần dù có nhiều lịch học. Với lịch học lại, nhóm chưa học nội dung hiện tại
 * là ưu tiên chính. Khi thiếu log, thuật toán giữ phòng cũ và chỉ cân bằng sĩ số.
 */
const assignTopClassStudents = (students, availableTargets) => {
    if (!students.length)
        return buildResult('topclass', [], []);
    const classroomCount = Math.ceil(students.length / 15);
    if (availableTargets.length < classroomCount) {
        throw new Error(`TopClass cần ${classroomCount} classroom nhưng hiện chỉ cấu hình ${availableTargets.length}`);
    }
    const targets = availableTargets.slice(0, classroomCount);
    const capacities = (0, exports.getBalancedCapacities)(students.length, classroomCount);
    const assignments = [];
    const pending = [];
    targets.forEach((target, index) => {
        const currentStudents = students
            .filter((student) => getPreferredTopClassRoomId(student) === target.roomId)
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
    pending.push(...students.filter((student) => {
        const preferredRoomId = getPreferredTopClassRoomId(student);
        return preferredRoomId === null || !validRoomIds.has(preferredRoomId);
    }));
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
    const hasCompleteAttendance = students.every((student) => Number.isInteger(student.recentAttendanceCount));
    if (!hasCompleteAttendance || targets.length < 2) {
        return buildResult('topclass', targets, assignments);
    }
    // Bắt đầu từ phương án giữ phòng cũ tối đa ở trên. Sau đó chỉ đổi chéo từng
    // cặp học sinh giữa hai phòng; vì là swap nên capacity và chênh lệch sĩ số
    // không bao giờ bị thay đổi.
    const buckets = targets.map((target, index) => ({
        ...target,
        classroomIndex: index + 1,
        students: assignments
            .filter((assignment) => assignment.targetRoomId === target.roomId)
            .map((assignment) => assignment),
    }));
    const getAttendance = (student) => (Number(student.recentAttendanceCount));
    const hasMakeupSignal = students.every((student) => typeof student.needsCurrentLesson === 'boolean');
    const isExpected = (student) => (hasMakeupSignal
        ? student.needsCurrentLesson === true
        : getAttendance(student) > 0);
    const getMetrics = (bucket) => ({
        expected: bucket.students.filter(isExpected).length,
        score: bucket.students.reduce((total, student) => total + getAttendance(student), 0),
    });
    const mismatch = (student, roomId) => (Number(getPreferredTopClassRoomId(student) !== roomId));
    // Pha 1: cân bằng nhóm dự kiến tham gia. Với lịch học lại, đây là những học
    // sinh chưa học nội dung; với lịch lần đầu, đây là nhóm có học bài gần đây.
    const totalExpected = students.filter(isExpected).length;
    const expectedBase = Math.floor(totalExpected / buckets.length);
    const expectedRemainder = totalExpected % buckets.length;
    const currentMetrics = buckets.map(getMetrics);
    const receivesRemainder = new Set(buckets
        .map((bucket, index) => ({
        index,
        expected: currentMetrics[index].expected,
        canReceive: bucket.students.length > expectedBase,
    }))
        .filter((item) => item.canReceive)
        .sort((left, right) => right.expected - left.expected || left.index - right.index)
        .slice(0, expectedRemainder)
        .map((item) => item.index));
    const expectedTargets = buckets.map((_, index) => (expectedBase + Number(receivesRemainder.has(index))));
    const chooseStudent = (bucketIndex, destinationIndex, predicate) => {
        const bucket = buckets[bucketIndex];
        const destination = buckets[destinationIndex];
        return bucket.students
            .map((student, index) => ({
            index,
            mismatchDelta: mismatch(student, destination.roomId) - mismatch(student, bucket.roomId),
            identity: student.identity,
        }))
            .filter((item) => predicate(bucket.students[item.index]))
            .sort((left, right) => (left.mismatchDelta - right.mismatchDelta
            || left.identity.localeCompare(right.identity, 'en', { numeric: true })))[0]?.index;
    };
    while (true) {
        const metrics = buckets.map(getMetrics);
        const surplus = buckets
            .map((_, index) => ({ index, amount: metrics[index].expected - expectedTargets[index] }))
            .filter((item) => item.amount > 0)
            .sort((left, right) => right.amount - left.amount || left.index - right.index)[0];
        const deficit = buckets
            .map((_, index) => ({ index, amount: expectedTargets[index] - metrics[index].expected }))
            .filter((item) => item.amount > 0)
            .sort((left, right) => right.amount - left.amount || left.index - right.index)[0];
        if (!surplus || !deficit)
            break;
        const activeIndex = chooseStudent(surplus.index, deficit.index, isExpected);
        const absentIndex = chooseStudent(deficit.index, surplus.index, (student) => !isExpected(student));
        if (activeIndex === undefined || absentIndex === undefined) {
            throw new Error('Không thể cân bằng chuyên cần giữa các classroom');
        }
        const activeStudent = buckets[surplus.index].students[activeIndex];
        buckets[surplus.index].students[activeIndex] = buckets[deficit.index].students[absentIndex];
        buckets[deficit.index].students[absentIndex] = activeStudent;
    }
    // Pha 2: nhóm dự kiến tham gia đã cân bằng. Chỉ swap trong chính nhóm đó để
    // dàn đều thêm mức chuyên cần theo nội dung mà không phá kết quả pha 1.
    for (let iteration = 0; iteration < students.length * 2; iteration += 1) {
        let best = null;
        for (let leftBucket = 0; leftBucket < buckets.length; leftBucket += 1) {
            for (let rightBucket = leftBucket + 1; rightBucket < buckets.length; rightBucket += 1) {
                const left = buckets[leftBucket];
                const right = buckets[rightBucket];
                const leftMetrics = getMetrics(left);
                const rightMetrics = getMetrics(right);
                for (let leftAttendance = 0; leftAttendance <= 3; leftAttendance += 1) {
                    for (let rightAttendance = 0; rightAttendance <= 3; rightAttendance += 1) {
                        if (leftAttendance === rightAttendance)
                            continue;
                        const nextLeftScore = leftMetrics.score - leftAttendance + rightAttendance;
                        const nextRightScore = rightMetrics.score - rightAttendance + leftAttendance;
                        const scoreGain = (leftMetrics.score ** 2 + rightMetrics.score ** 2
                            - nextLeftScore ** 2 - nextRightScore ** 2);
                        if (scoreGain <= 0)
                            continue;
                        const leftStudent = chooseStudent(leftBucket, rightBucket, (student) => isExpected(student) && getAttendance(student) === leftAttendance);
                        const rightStudent = chooseStudent(rightBucket, leftBucket, (student) => isExpected(student) && getAttendance(student) === rightAttendance);
                        if (leftStudent === undefined || rightStudent === undefined)
                            continue;
                        const leftItem = left.students[leftStudent];
                        const rightItem = right.students[rightStudent];
                        const mismatchDelta = (mismatch(leftItem, right.roomId) + mismatch(rightItem, left.roomId)
                            - mismatch(leftItem, left.roomId) - mismatch(rightItem, right.roomId));
                        const candidate = {
                            leftBucket,
                            rightBucket,
                            leftStudent,
                            rightStudent,
                            scoreGain,
                            mismatchDelta,
                            identityKey: `${leftItem.identity}:${rightItem.identity}`,
                        };
                        if (!best
                            || candidate.scoreGain > best.scoreGain
                            || (candidate.scoreGain === best.scoreGain
                                && candidate.mismatchDelta < best.mismatchDelta)
                            || (candidate.scoreGain === best.scoreGain
                                && candidate.mismatchDelta === best.mismatchDelta
                                && candidate.identityKey.localeCompare(best.identityKey, 'en', { numeric: true }) < 0)) {
                            best = candidate;
                        }
                    }
                }
            }
        }
        if (!best)
            break;
        const left = buckets[best.leftBucket];
        const right = buckets[best.rightBucket];
        const leftItem = left.students[best.leftStudent];
        left.students[best.leftStudent] = right.students[best.rightStudent];
        right.students[best.rightStudent] = leftItem;
    }
    return buildResult('topclass', targets, buckets.flatMap((bucket) => (bucket.students.map((student) => ({
        ...student,
        targetRoomId: bucket.roomId,
        targetClassId: bucket.classId,
        classroomIndex: bucket.classroomIndex,
    })))));
};
exports.assignTopClassStudents = assignTopClassStudents;
/**
 * TopUni chia đều bốn nhóm tương tác theo ngưỡng cố định. Học sinh của buổi trước
 * được giữ room tối đa trong chỉ tiêu của từng nhóm; chỉ phần vượt chỉ tiêu hoặc
 * học sinh mới được đưa vào các chỗ còn thiếu.
 */
const getTopUniInteractionTier = (interactionScore) => {
    if (interactionScore > 7)
        return 'high';
    if (interactionScore >= 4)
        return 'medium';
    if (interactionScore >= 1)
        return 'low';
    return 'none';
};
exports.getTopUniInteractionTier = getTopUniInteractionTier;
const assignTopUniStudents = (students, availableTargets, maxStudentsPerClassroom = exports.TOPUNI_MAX_STUDENTS_PER_CLASSROOM) => {
    if (!students.length)
        return buildResult('topuni', [], []);
    if (!Number.isInteger(maxStudentsPerClassroom) || maxStudentsPerClassroom <= 0) {
        throw new Error('Số học sinh tối đa mỗi phòng TopUni phải là số nguyên dương');
    }
    const classroomCount = Math.ceil(students.length / maxStudentsPerClassroom);
    if (availableTargets.length < classroomCount) {
        const capacityHint = availableTargets.length
            ? ` Để sử dụng ${availableTargets.length} phòng hiện có, hãy đặt tối đa ít nhất `
                + `${Math.ceil(students.length / availableTargets.length).toLocaleString('vi-VN')} học sinh/phòng`
            : ' Hãy cấu hình phòng TopUni trước khi chia lớp';
        throw new Error(`TopUni có ${students.length.toLocaleString('vi-VN')} học sinh nên cần ${classroomCount} classroom `
            + `(tối đa ${maxStudentsPerClassroom} học sinh/phòng), nhưng hiện chỉ cấu hình `
            + `${availableTargets.length}.${capacityHint}`);
    }
    const targets = availableTargets.slice(0, classroomCount);
    const capacities = (0, exports.getBalancedCapacities)(students.length, classroomCount);
    const tierOrder = ['high', 'medium', 'low', 'none'];
    const studentsWithTier = students.map((student) => ({
        ...student,
        interactionTier: (0, exports.getTopUniInteractionTier)(student.interactionScore),
    }));
    // Lập quota cho từng nhóm trước. Tổng quota của mỗi phòng luôn đúng capacity,
    // đồng thời số học sinh cùng một nhóm giữa các phòng chênh lệch tối đa 1 khi
    // capacity cho phép.
    const quotaBuckets = targets.map((target, index) => ({
        roomId: target.roomId,
        classroomIndex: index + 1,
        capacity: capacities[index],
        total: 0,
        tierCounts: { high: 0, medium: 0, low: 0, none: 0 },
    }));
    tierOrder.forEach((tier) => {
        const tierCount = studentsWithTier.filter((student) => student.interactionTier === tier).length;
        for (let index = 0; index < tierCount; index += 1) {
            const target = quotaBuckets
                .filter((bucket) => bucket.total < bucket.capacity)
                .sort((left, right) => (left.tierCounts[tier] - right.tierCounts[tier]
                || left.total - right.total
                || left.classroomIndex - right.classroomIndex))[0];
            if (!target)
                throw new Error('Không thể lập chỉ tiêu tương tác cho classroom');
            target.tierCounts[tier] += 1;
            target.total += 1;
        }
    });
    const buckets = targets.map((target, index) => ({
        roomId: target.roomId,
        classId: target.classId,
        classroomIndex: index + 1,
        capacity: capacities[index],
        interactionScore: 0,
        targetTierCounts: quotaBuckets[index].tierCounts,
        tierCounts: { high: 0, medium: 0, low: 0, none: 0 },
        students: [],
    }));
    const keptIds = new Set();
    buckets.forEach((bucket) => {
        tierOrder.forEach((tier) => {
            const kept = studentsWithTier
                .filter((student) => (student.wasInPreviousSession
                && student.preferredRoomId === bucket.roomId
                && student.interactionTier === tier))
                .sort(compareStudents)
                .slice(0, bucket.targetTierCounts[tier]);
            kept.forEach((student) => {
                bucket.students.push(student);
                bucket.tierCounts[tier] += 1;
                bucket.interactionScore += student.interactionScore;
                keptIds.add(student.id);
            });
        });
    });
    tierOrder.forEach((tier) => {
        const pending = studentsWithTier
            .filter((student) => student.interactionTier === tier && !keptIds.has(student.id))
            .sort((left, right) => (right.interactionScore - left.interactionScore || compareStudents(left, right)));
        pending.forEach((student) => {
            const candidates = buckets
                .filter((bucket) => bucket.tierCounts[tier] < bucket.targetTierCounts[tier])
                .sort((left, right) => (left.interactionScore - right.interactionScore
                || Number(right.roomId === student.preferredRoomId)
                    - Number(left.roomId === student.preferredRoomId)
                || left.students.length - right.students.length
                || left.classroomIndex - right.classroomIndex));
            const target = candidates[0];
            if (!target)
                throw new Error(`Không tìm được classroom còn chỉ tiêu nhóm ${tier}`);
            target.students.push(student);
            target.interactionScore += student.interactionScore;
            target.tierCounts[tier] += 1;
        });
    });
    const assignments = buckets.flatMap((bucket) => bucket.students.map((student) => ({
        ...student,
        targetRoomId: bucket.roomId,
        targetClassId: bucket.classId,
        classroomIndex: bucket.classroomIndex,
    })));
    return buildResult('topuni', targets, assignments);
};
exports.assignTopUniStudents = assignTopUniStudents;
