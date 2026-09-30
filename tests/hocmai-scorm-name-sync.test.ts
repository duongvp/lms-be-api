import assert from "node:assert/strict";
import test from "node:test";
import { buildScheduleOccurrenceMap } from "../src/modules/lessons/hocmai-scorm-name-sync.service";

const base = {
  lesson_id: 33,
  learn_number: 33,
  source_lesson_name: "Bảo vệ đa dạng sinh học.",
  calendar_lesson_name: "Bảo vệ đa dạng sinh học.",
  lesson_count: 0,
  teacher: "Đỗ Thị Minh Thư",
  teacher_name: null,
};

test("2 lịch x 2 course vẫn dùng đúng occurrence 1, 1, 2, 2", () => {
  const rows = [
    { ...base, calendar_id: 3516, start_time: "2027-04-20T20:00:00.000Z", package_id: "9152", course_id: "3255" },
    { ...base, calendar_id: 3516, start_time: "2027-04-20T20:00:00.000Z", package_id: "9223", course_id: "3359" },
    { ...base, calendar_id: 3548, start_time: "2027-04-23T20:00:00.000Z", package_id: "9152", course_id: "3255" },
    { ...base, calendar_id: 3548, start_time: "2027-04-23T20:00:00.000Z", package_id: "9223", course_id: "3359" },
  ];
  const occurrences = buildScheduleOccurrenceMap(rows);
  assert.equal(occurrences.get("3516"), 1);
  assert.equal(occurrences.get("3548"), 2);
  assert.equal(occurrences.size, 2);
});

test("cùng bài nhưng khác giáo viên được đánh số lịch độc lập", () => {
  const rows = [
    { ...base, calendar_id: 1, start_time: "2027-04-20T20:00:00.000Z", package_id: "1", course_id: "1" },
    { ...base, calendar_id: 2, start_time: "2027-04-21T20:00:00.000Z", teacher: "Giáo viên khác", package_id: "1", course_id: "1" },
  ];
  const occurrences = buildScheduleOccurrenceMap(rows);
  assert.equal(occurrences.get("1"), 1);
  assert.equal(occurrences.get("2"), 1);
});
