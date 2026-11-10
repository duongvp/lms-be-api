import prisma from "../../lib/prisma";
import { fetchHocmaiCourseOutlines } from "../../integrations/hocmai-course-outline.service";
import { logger } from "../../utils/logger";
import {
  compatibleParts,
  matchCalendarsForCourse,
  type CalendarCandidateMatch,
  normalizeTitle,
  titleSimilarity,
} from "../hmo-lesson-sync/hmo-lesson-sync.service";

export type HocmaiScormOptions = {
  matchingMode?: "name_teacher" | "lesson_id";
  teacherPrefixes?: Record<string, string>;
};
export const parseHocmaiScormOptions = (input: unknown = {}): HocmaiScormOptions => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Thiết lập đồng bộ không hợp lệ");
  const value = input as HocmaiScormOptions;
  const matchingMode = value.matchingMode ?? "name_teacher";
  if (matchingMode !== "name_teacher" && matchingMode !== "lesson_id")
    throw new Error("Luồng ghép Lesson không hợp lệ");
  const prefixes = value.teacherPrefixes ?? {};
  if (typeof prefixes !== "object" || Array.isArray(prefixes) || !prefixes)
    throw new Error("Danh sách tiền tố giáo viên không hợp lệ");
  const teacherPrefixes: Record<string, string> = Object.create(null);
  for (const [key, prefix] of Object.entries(prefixes)) {
    if (!key || typeof prefix !== "string" || prefix.length > 50 || /[\r\n\x00-\x1f]/.test(prefix))
      throw new Error("Tiền tố giáo viên phải là văn bản tối đa 50 ký tự");
    if (prefix.trim()) teacherPrefixes[key] = prefix.trim().replace(/\s+/g, " ");
  }
  return { matchingMode, teacherPrefixes };
};

type ScheduleRow = {
  calendar_id: bigint | number | string;
  lesson_id: bigint | number | string;
  learn_number: number;
  source_lesson_name: string;
  calendar_lesson_name: string | null;
  lesson_count: number | null;
  start_time: Date | string;
  teacher: string | null;
  teacher_name: string | null;
  package_id: string | null;
  course_id: string | null;
};

type OutlineLesson = {
  lessonId: string;
  name?: string;
  sectionId?: string;
  sectionName?: string;
  sectionIndex?: number;
  lessonIndex?: number;
};
export type HocmaiScormCandidateSession = {
  key: string;
  name: string;
  lessons: Array<{ lessonId: string; name: string; lessonIndex?: number }>;
};
export type HocmaiScormPreviewStatus = "update" | "unchanged" | "skipped";
export type HocmaiScormPreviewRow = {
  key: string;
  learnNumber: number;
  lessonName: string;
  teacherName: string;
  scheduleTime: string;
  occurrence: number;
  packageId?: string;
  courseId?: string;
  hocmaiLessonId?: string;
  hocmaiSessionName?: string;
  currentName?: string;
  expectedName?: string;
  status: HocmaiScormPreviewStatus;
  reason?: string;
  sharedTarget?: boolean;
  candidateSessions?: HocmaiScormCandidateSession[];
};
export type HocmaiScormPreview = {
  programCode: string;
  teacherCount: number;
  scheduleCount: number;
  packageCourseCount: number;
  updateCount: number;
  unchangedCount: number;
  skippedCount: number;
  rows: HocmaiScormPreviewRow[];
  warnings: string[];
};

const clean = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
const canonicalTeacher = (value: unknown) =>
  clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/^\s*(?:co|thay)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const teacherMatchQuality = (leftValue: unknown, rightValue: unknown) => {
  const left = canonicalTeacher(leftValue);
  const right = canonicalTeacher(rightValue);
  if (!left || !right) return -1;
  if (left === right) return 2;
  return left.split(" ").at(-1) === right || right.split(" ").at(-1) === left
    ? 1
    : -1;
};
const pairKey = (packageId: unknown, courseId: unknown) =>
  `${String(packageId)}::${String(courseId)}`;
const stripOperationalPrefix = (value: string) =>
  value.replace(/^\s*\[\s*(?:HỌC BÙ|HOC BU)\s*\]\s*[-–—:]*\s*/iu, "");
const outlineParts = (value: unknown) => {
  const raw = stripOperationalPrefix(clean(value));
  const suffix = /(?:_|-\s*)\s*(Cô|Thầy)\s+(.+?)\s*$/iu.exec(raw);
  return {
    title: normalizeTitle(
      suffix?.index === undefined ? raw : raw.slice(0, suffix.index),
    ),
    teacher: suffix?.[2] ? canonicalTeacher(suffix[2]) : "",
    honorific: suffix?.[1] || "",
  };
};
const titleScore = (leftValue: unknown, rightValue: unknown) => {
  const left = normalizeTitle(leftValue);
  const right = normalizeTitle(rightValue);
  return compatibleParts(left, right) ? titleSimilarity(left, right) : 0;
};
const displayTeacher = (row: ScheduleRow) =>
  clean(row.teacher_name || row.teacher);
const scheduleOccurrence = (row: ScheduleRow) => {
  if (row.lesson_count !== null && row.lesson_count !== undefined) {
    const count = Number(row.lesson_count);
    if (Number.isInteger(count) && count >= 0) return count + 1;
  }
  const match = /^\s*\[\s*Lịch\s*(\d+)\s*\]/iu.exec(
    clean(row.calendar_lesson_name),
  );
  const occurrence = Number(match?.[1] || 1);
  return Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
};
const scheduleGroupKey = (row: ScheduleRow) =>
  `${String(row.lesson_id)}::${canonicalTeacher(displayTeacher(row))}`;

export const buildScheduleOccurrenceMap = (rows: ScheduleRow[]) => {
  const calendarsByGroup = new Map<
    string,
    Map<string, { calendarId: string; startTime: Date | string }>
  >();
  rows.forEach((row) => {
    const groupKey = scheduleGroupKey(row);
    const calendarId = String(row.calendar_id);
    const calendars = calendarsByGroup.get(groupKey) || new Map();
    if (!calendars.has(calendarId)) {
      calendars.set(calendarId, { calendarId, startTime: row.start_time });
      calendarsByGroup.set(groupKey, calendars);
    }
  });

  const result = new Map<string, number>();
  calendarsByGroup.forEach((calendars) => {
    Array.from(calendars.values())
      .sort((left, right) => {
        const timeDiff = new Date(left.startTime).getTime()
          - new Date(right.startTime).getTime();
        return timeDiff || left.calendarId.localeCompare(
          right.calendarId,
          "vi",
          { numeric: true },
        );
      })
      .forEach((calendar, index) => result.set(calendar.calendarId, index + 1));
  });
  return result;
};
const scormBaseName = (value: unknown) =>
  clean(value).replace(/\.+$/, "").trim();
const numericId = (value: string, label: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${label} không hợp lệ: ${value}`);
  return parsed;
};

type TeacherHonorific = "Cô" | "Thầy";
const teacherHonorific = (value: unknown): TeacherHonorific | undefined => {
  const match = /^(Cô|Thầy)\s+/iu.exec(clean(value));
  return match ? (/^cô$/iu.test(match[1]) ? "Cô" : "Thầy") : undefined;
};
const fullTeacherDisplayName = (row: ScheduleRow) =>
  displayTeacher(row).replace(/^(?:Cô|Thầy)\s+/iu, "").trim();
const teacherNaming = (
  row: ScheduleRow,
  candidate: OutlineLesson,
  schedules: ScheduleRow[],
  outlines: OutlineLesson[],
  options: HocmaiScormOptions,
) => {
  const teacherName = fullTeacherDisplayName(row);
  const teacherKey = canonicalTeacher(teacherName);
  const baseName = scormBaseName(row.source_lesson_name);
  const knownTeachers = Array.from(new Set(schedules.map((item) =>
    canonicalTeacher(displayTeacher(item)),
  ).filter(Boolean)));
  const honorifics = new Set<TeacherHonorific>();
  for (const item of schedules) {
    if (canonicalTeacher(displayTeacher(item)) !== teacherKey) continue;
    const title = teacherHonorific(displayTeacher(item));
    if (title) honorifics.add(title);
  }
  for (const item of [candidate, ...outlines]) {
    const parts = outlineParts(item.name);
    if (!parts.honorific || !parts.teacher || teacherMatchQuality(teacherName, parts.teacher) < 1) continue;
    // A short name such as Anh cannot establish a title if several teachers
    // in the program have that name. Never infer gender from the full name.
    if (parts.teacher !== teacherKey && knownTeachers.filter((teacher) =>
      teacherMatchQuality(teacher, parts.teacher) >= 1,
    ).length !== 1) continue;
    honorifics.add(/^cô$/iu.test(parts.honorific) ? "Cô" : "Thầy");
  }
  const honorific = options.teacherPrefixes?.[teacherKey]
    || (honorifics.size === 1 ? Array.from(honorifics)[0] : undefined);
  const fullNameKnown = teacherKey.split(" ").filter(Boolean).length >= 2;
  return {
    baseName,
    teacherName,
    honorific,
    requiresHonorific: !honorific,
    suggestedName: honorific && fullNameKnown ? `${baseName}_${honorific} ${teacherName}` : "",
    fullNameKnown,
  };
};

const getProgramSchedules = async (programCode: string) => prisma.$queryRaw<
  ScheduleRow[]
>`
  SELECT c.id AS calendar_id, l.id AS lesson_id, l.learn_number,
    l.lesson_name AS source_lesson_name,
    c.lesson_name AS calendar_lesson_name, c.lesson_count,
    c.start_time, c.teacher,
    tp.display_name AS teacher_name, lcm.package_id, lcm.course_id
  FROM (SELECT * FROM calendar WHERE deleted_at IS NULL) AS c
  INNER JOIN lessons l ON l.id = c.session_id AND l.status <> 0
  LEFT JOIN teacher_profiles tp ON tp.username = c.teacher
  LEFT JOIN lesson_course_mapping lcm ON lcm.lesson_id = l.id
  WHERE l.subject_code = ${programCode}
    AND COALESCE(c.lesson_status, 0) <> 1
  ORDER BY l.learn_number, c.start_time, c.id, lcm.package_id, lcm.course_id
`;

const assertTeacherPrefixes = (schedules: ScheduleRow[], options: HocmaiScormOptions) => {
  const keys = new Set(schedules.map((row) => canonicalTeacher(displayTeacher(row))).filter(Boolean));
  if (Object.keys(options.teacherPrefixes || {}).some((key) => !keys.has(key)))
    throw new Error("Tiền tố chứa giáo viên không thuộc chương trình đang chọn");
};
export const getHocmaiScormTeachers = async (programCodeInput: string) => {
  const programCode = clean(programCodeInput);
  if (!programCode) throw new Error("Vui lòng chọn Chương trình");
  const schedules = await getProgramSchedules(programCode);
  return Array.from(new Map(schedules.map((row) => [
    canonicalTeacher(displayTeacher(row)),
    { key: canonicalTeacher(displayTeacher(row)), name: fullTeacherDisplayName(row),
      prefix: teacherHonorific(displayTeacher(row)) || "" },
  ])).values()).filter((teacher) => teacher.key)
    .sort((left, right) => left.name.localeCompare(right.name, "vi"));
};

const scheduleMonthYear = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  // MySQL DATETIME được driver trả thành Date với chính các thành phần giờ lưu
  // trong UTC; dùng UTC để không làm lệch tháng ở ranh giới ngày/tháng.
  return { month: date.getUTCMonth() + 1, year: date.getUTCFullYear() };
};
const sectionMonthYear = (value: unknown) => {
  const normalized = clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const match = /(?:^|\b)thang\s*(\d{1,2})(?:\s*[\/-]\s*(\d{4}))?/.exec(
    normalized,
  );
  if (!match) return undefined;
  const month = Number(match[1]);
  const year = match[2] ? Number(match[2]) : undefined;
  return month >= 1 && month <= 12 ? { month, year } : undefined;
};
const sessionMatchQuality = (row: ScheduleRow, candidate: OutlineLesson) => {
  const schedule = scheduleMonthYear(row.start_time);
  const section = sectionMonthYear(candidate.sectionName);
  if (!schedule || !section) return 0;
  if (schedule.month !== section.month) return -1;
  if (section.year && section.year !== schedule.year) return -1;
  return section.year === schedule.year ? 2 : 1;
};
const groupCandidateSessions = (
  candidates: OutlineLesson[],
): HocmaiScormCandidateSession[] => {
  const groups = new Map<string, HocmaiScormCandidateSession>();
  candidates.forEach((candidate) => {
    const key = candidate.sectionId ||
      `index:${candidate.sectionIndex ?? "unknown"}:${candidate.sectionName || ""}`;
    const group = groups.get(key) || {
      key,
      name: clean(candidate.sectionName) || "Không rõ session",
      lessons: [],
    };
    group.lessons.push({
      lessonId: candidate.lessonId,
      name: clean(candidate.name) || `Lesson ${candidate.lessonId}`,
      lessonIndex: candidate.lessonIndex,
    });
    groups.set(key, group);
  });
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      lessons: group.lessons.sort((left, right) =>
        (left.lessonIndex ?? Number.MAX_SAFE_INTEGER)
          - (right.lessonIndex ?? Number.MAX_SAFE_INTEGER)
        || left.lessonId.localeCompare(right.lessonId, "vi", { numeric: true }),
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "vi", { numeric: true }));
};

const resolveOutlineLesson = (
  row: ScheduleRow,
  candidates: OutlineLesson[],
  multipleTeachers: boolean,
  includeAlternatives = false,
  allowUnnamedTeacher = false,
): { candidates: OutlineLesson[]; sessionCertain: boolean } => {
  const localTitle = normalizeTitle(row.source_lesson_name);
  let evaluated = candidates
    .map((candidate) => {
      const candidateParts = outlineParts(candidate.name);
      return {
        candidate,
        title: candidateParts.title,
        score: titleScore(row.source_lesson_name, candidateParts.title),
        teacherQuality: allowUnnamedTeacher && !candidateParts.teacher
          ? 0
          : multipleTeachers
            ? teacherMatchQuality(displayTeacher(row), candidateParts.teacher)
            : 0,
        sessionQuality: sessionMatchQuality(row, candidate),
      };
    })
    .filter((item) => item.score >= 0.92 && item.teacherQuality >= 0);
  if (!evaluated.length) return { candidates: [], sessionCertain: false };

  // Chỉ tự động chọn khi section có đủ Tháng M/YYYY và khớp chính xác
  // với lịch. Section thiếu năm/tên không chuẩn phải được người dùng xác nhận.
  const exactSessionMatches = evaluated.filter(
    (item) => item.sessionQuality === 2,
  );
  const sessionCertain = exactSessionMatches.length > 0;
  if (sessionCertain) evaluated = exactSessionMatches;

  if (multipleTeachers && !includeAlternatives) {
    const bestTeacherQuality = Math.max(
      ...evaluated.map((item) => item.teacherQuality),
    );
    evaluated = evaluated.filter(
      (item) => item.teacherQuality === bestTeacherQuality,
    );
  }
  const exactTitleMatches = evaluated.filter(
    (item) => item.title === localTitle,
  );
  if (exactTitleMatches.length) evaluated = exactTitleMatches;

  if (!sessionCertain) {
    return {
      candidates: evaluated.map((item) => item.candidate),
      sessionCertain: false,
    };
  }
  if (includeAlternatives || evaluated.length <= 1) {
    return {
      candidates: evaluated.map((item) => item.candidate),
      sessionCertain: true,
    };
  }
  evaluated.sort(
    (left, right) =>
      right.score - left.score ||
      left.candidate.lessonId.localeCompare(right.candidate.lessonId, "vi", {
        numeric: true,
      }),
  );
  if (evaluated[0].score - evaluated[1].score >= 0.02) {
    return { candidates: [evaluated[0].candidate], sessionCertain: true };
  }
  return {
    candidates: evaluated.map((item) => item.candidate),
    sessionCertain: true,
  };
};

export const previewHocmaiScormNameSync = async (
  programCodeInput: string,
  optionsInput: HocmaiScormOptions = {},
): Promise<HocmaiScormPreview> => {
  const options = parseHocmaiScormOptions(optionsInput);
  const programCode = clean(programCodeInput);
  if (!programCode) throw new Error("Vui lòng chọn Chương trình");
  const schedules = await getProgramSchedules(programCode);
  assertTeacherPrefixes(schedules, options);
  if (!schedules.length)
    throw new Error(
      `Chương trình ${programCode} chưa có lịch học để đối chiếu`,
    );

  const teacherKeys = new Set(
    schedules
      .map((row) => canonicalTeacher(displayTeacher(row)))
      .filter(Boolean),
  );
  const multipleTeachers = teacherKeys.size > 1;
  const pairMap = new Map<string, { packageId: string; courseId: string }>();
  schedules.forEach((row) => {
    if (!row.package_id || !row.course_id) return;
    const pair = {
      packageId: String(row.package_id),
      courseId: String(row.course_id),
    };
    pairMap.set(pairKey(pair.packageId, pair.courseId), pair);
  });
  const outlineByPair = new Map<string, { lessons: OutlineLesson[] }>();
  const outlineErrors = new Map<string, string>();
  await Promise.all(
    Array.from(pairMap.values()).map(async (pair) => {
      try {
        const [outline] = await fetchHocmaiCourseOutlines([pair]);
        if (!outline?.exists)
          outlineErrors.set(
            pairKey(pair.packageId, pair.courseId),
            "HOCMAI không tìm thấy Course/Package",
          );
        else
          outlineByPair.set(pairKey(pair.packageId, pair.courseId), {
            lessons: outline.lessons,
          });
      } catch (error: any) {
        outlineErrors.set(
          pairKey(pair.packageId, pair.courseId),
          clean(error?.message || error),
        );
      }
    }),
  );

  // Reuse the exact Lesson-ID allocation algorithm, grouped by Package/Course
  // and internal lesson as in the Lesson-ID sync, without reading old mappings.
  const courseMatches = new Map<string, CalendarCandidateMatch>();
  if (options.matchingMode === "lesson_id") pairMap.forEach((pair, pairId) => {
    const groups = new Map<string, Map<string, ScheduleRow>>();
    for (const row of schedules) {
      if (pairKey(row.package_id, row.course_id) !== pairId) continue;
      const group = groups.get(String(row.lesson_id)) || new Map<string, ScheduleRow>();
      group.set(String(row.calendar_id), row);
      groups.set(String(row.lesson_id), group);
    }
    groups.forEach((group) => {
      const calendars = Array.from(group.values()).map((row) => ({
        ...row,
        subject_code: programCode,
        lesson_name: row.calendar_lesson_name,
      }));
      matchCalendarsForCourse(calendars, outlineByPair.get(pairId)?.lessons || []).forEach((match, calendarId) => {
        courseMatches.set(`${calendarId}::${pair.packageId}::${pair.courseId}`, match);
      });
    });
  });

  const resolutions = new Map<string, ReturnType<typeof resolveOutlineLesson>>();
  const selectedLessons = new Map<string, OutlineLesson>();
  const repeatedWarnings = new Map<string, string>();
  const repeatedGroups = new Map<string, Map<string, ScheduleRow>>();
  const scheduleKey = (row: ScheduleRow) => `${row.calendar_id}::${row.package_id || ""}::${row.course_id || ""}`;
  schedules.forEach((row) => {
    const key = scheduleKey(row);
    const outline = outlineByPair.get(pairKey(row.package_id, row.course_id));
    const resolution = resolveOutlineLesson(row, outline?.lessons || [], multipleTeachers);
    resolutions.set(key, resolution);
    const match = courseMatches.get(key);
    const selected = options.matchingMode === "lesson_id"
      ? outline?.lessons.find((lesson) => lesson.lessonId === match?.lessonId)
      : resolution.candidates.length === 1 && resolution.sessionCertain ? resolution.candidates[0] : undefined;
    if (selected) selectedLessons.set(key, selected);
    const month = new Date(row.start_time).toISOString().slice(0, 7);
    const groupKey = `${row.package_id}::${row.course_id}::${row.lesson_id}::${canonicalTeacher(displayTeacher(row))}::${month}`;
    const group = repeatedGroups.get(groupKey) || new Map<string, ScheduleRow>();
    group.set(String(row.calendar_id), row);
    repeatedGroups.set(groupKey, group);
  });
  // Ranking may prefer one full-name suffix over another valid short-name
  // suffix. Allocate the complete repeated group before accepting shared IDs.
  repeatedGroups.forEach((group) => {
    const calendars = Array.from(group.values()).sort((left, right) =>
      new Date(left.start_time).getTime() - new Date(right.start_time).getTime()
      || String(left.calendar_id).localeCompare(String(right.calendar_id), "vi", { numeric: true }),
    );
    const ids = calendars.map((row) => selectedLessons.get(scheduleKey(row))?.lessonId).filter(Boolean);
    if (new Set(ids).size === ids.length) return;
    const expanded = calendars.map((row) => resolveOutlineLesson(
      row, outlineByPair.get(pairKey(row.package_id, row.course_id))?.lessons || [],
      multipleTeachers, true, options.matchingMode === "lesson_id",
    ));
    const candidates = Array.from(new Map(expanded[0].candidates.map((lesson) => [lesson.lessonId, lesson])).values())
      .sort((left, right) => (left.lessonIndex ?? Number.MAX_SAFE_INTEGER) - (right.lessonIndex ?? Number.MAX_SAFE_INTEGER)
        || left.lessonId.localeCompare(right.lessonId, "vi", { numeric: true }));
    const candidateIds = candidates.map((lesson) => lesson.lessonId).sort().join("|");
    const distinctDates = new Set(calendars.map((row) => new Date(row.start_time).toISOString()));
    const safeAllocation = distinctDates.size === calendars.length
      && candidates.length === calendars.length
      && groupCandidateSessions(candidates).length === 1
      && new Set(candidates.map((lesson) => outlineParts(lesson.name).title)).size === 1
      && expanded.every((resolution) => resolution.sessionCertain
        && Array.from(new Set(resolution.candidates.map((lesson) => lesson.lessonId))).sort().join("|") === candidateIds);
    calendars.forEach((row, index) => {
      const key = scheduleKey(row);
      if (safeAllocation) selectedLessons.set(key, candidates[index]);
      else {
        selectedLessons.delete(key);
        resolutions.set(key, expanded[index]);
        repeatedWarnings.set(key, "Các lịch khác ngày cần Lesson ID riêng; chưa đủ ứng viên chắc chắn để phân bổ, vui lòng chọn thủ công");
      }
    });
  });

  const rows: HocmaiScormPreviewRow[] = [];
  const targetRowIndexes = new Map<string, number[]>();
  const occurrenceByCalendar = buildScheduleOccurrenceMap(schedules);
  const seenSchedulePairs = new Set<string>();
  for (const schedule of schedules) {
    const schedulePairKey = `${String(schedule.calendar_id)}::${schedule.package_id || ""}::${schedule.course_id || ""}`;
    if (seenSchedulePairs.has(schedulePairKey)) continue;
    seenSchedulePairs.add(schedulePairKey);
    const base = {
      key: schedulePairKey,
      learnNumber: Number(schedule.learn_number),
      lessonName: clean(schedule.source_lesson_name),
      teacherName: displayTeacher(schedule),
      scheduleTime: new Date(schedule.start_time).toISOString(),
      occurrence: occurrenceByCalendar.get(String(schedule.calendar_id))
        || scheduleOccurrence(schedule),
      packageId: schedule.package_id ? String(schedule.package_id) : undefined,
      courseId: schedule.course_id ? String(schedule.course_id) : undefined,
    };
    if (!base.packageId || !base.courseId) {
      rows.push({
        ...base,
        status: "skipped",
        reason: "Bài học chưa được gắn Package/Course",
      });
      continue;
    }
    const pair = pairKey(base.packageId, base.courseId);
    if (outlineErrors.has(pair)) {
      rows.push({
        ...base,
        status: "skipped",
        reason: outlineErrors.get(pair),
      });
      continue;
    }
    const outline = outlineByPair.get(pair);
    const resolution = resolutions.get(schedulePairKey)!;
    const candidates = resolution.candidates;
    const matchedCandidate = selectedLessons.get(schedulePairKey);
    if (!matchedCandidate) {
      rows.push({
        ...base,
        status: "skipped",
        reason: repeatedWarnings.get(schedulePairKey) || (candidates.length
          ? resolution.sessionCertain
            ? "Có nhiều Lesson HOCMAI cùng khớp; vui lòng chọn session và Lesson"
            : "Session HOCMAI chưa có định dạng Tháng M/YYYY khớp lịch; vui lòng chọn session và Lesson"
          : "Không tìm thấy Lesson HOCMAI khớp tên bài và giáo viên"),
        candidateSessions: candidates.length
          ? groupCandidateSessions(candidates)
          : undefined,
      });
      continue;
    }
    const candidate = matchedCandidate;
    const naming = teacherNaming(schedule, candidate, schedules, outline?.lessons || [], options);
    const expectedName = naming.suggestedName;
    if (!expectedName) {
      rows.push({
        ...base,
        hocmaiLessonId: candidate.lessonId,
        hocmaiSessionName: clean(candidate.sectionName) || undefined,
        currentName: clean(candidate.name),
        status: "skipped",
        reason: naming.fullNameKnown
          ? "Đã tìm thấy Lesson ID; chưa đủ căn cứ xác định Cô/Thầy. Vui lòng chọn chức danh trong xử lý thủ công"
          : "Đã tìm thấy Lesson ID; thiếu họ tên đầy đủ của giáo viên theo lịch",
      });
      continue;
    }
    const target = `${base.courseId}::${candidate.lessonId}`;
    const currentName = clean(candidate.name);
    const targetIndexes = targetRowIndexes.get(target) || [];
    targetIndexes.push(rows.length);
    targetRowIndexes.set(target, targetIndexes);
    rows.push({
      ...base,
      hocmaiLessonId: candidate.lessonId,
      hocmaiSessionName: clean(candidate.sectionName) || undefined,
      currentName,
      expectedName,
      status: currentName === expectedName ? "unchanged" : "update",
    });
  }

  targetRowIndexes.forEach((indexes) => {
    if (indexes.length <= 1) return;
    const expectedNames = new Set(
      indexes.map((index) => rows[index].expectedName).filter(Boolean),
    );
    if (expectedNames.size > 1) {
      const reason =
        "Cùng một Lesson HOCMAI nhưng lịch cho ra hai tên đích khác nhau";
      indexes.forEach((index) => {
        rows[index] = { ...rows[index], status: "skipped", reason };
      });
      return;
    }
    if (new Set(indexes.map((index) => rows[index].key.split("::")[0])).size > 1) {
      indexes.forEach((index) => {
        rows[index] = { ...rows[index], status: "skipped",
          reason: "Lesson ID đang trùng giữa các lịch khác nhau; vui lòng chọn Lesson riêng cho từng lịch" };
      });
    }
  });

  const warnings = rows
    .filter((row) => row.status === "skipped")
    .map((row) => `Bài ${row.learnNumber}: ${row.reason}`);
  return {
    programCode,
    teacherCount: teacherKeys.size,
    scheduleCount: new Set(schedules.map((row) => String(row.calendar_id)))
      .size,
    packageCourseCount: pairMap.size,
    updateCount: new Set(
      rows
        .filter(
          (row) => row.status === "update" && row.courseId && row.hocmaiLessonId,
        )
        .map((row) => `${row.courseId}::${row.hocmaiLessonId}`),
    ).size,
    unchangedCount: rows.filter((row) => row.status === "unchanged").length,
    skippedCount: rows.filter((row) => row.status === "skipped").length,
    rows,
    warnings,
  };
};

export type HocmaiScormManualOverride = {
  rowKey: string;
  lessonId: string;
  expectedName: string;
};
export type HocmaiScormManualResolution = {
  rowKey: string;
  lessonId: string;
  currentName: string;
  suggestedName: string;
  baseName: string;
  teacherName: string;
  honorific?: string;
  requiresHonorific: boolean;
  sessionName?: string;
  packageId: string;
  courseId: string;
};

export type HocmaiScormManualSelection = {
  rowKey: string;
  lessonId: string;
};

// Manual selection lists the full outline; automatic title/teacher matching
// must not hide lessons that the operator needs to choose explicitly.
export const getManualHocmaiScormLessons = async (
  programCodeInput: string,
  rowKeyInput: string,
) => {
  const programCode = clean(programCodeInput);
  const rowKey = clean(rowKeyInput);
  if (!programCode || !rowKey)
    throw new Error("Chương trình hoặc dòng preview không hợp lệ");
  const schedules = await getProgramSchedules(programCode);
  const schedule = schedules.find((row) =>
    `${String(row.calendar_id)}::${row.package_id || ""}::${row.course_id || ""}` === rowKey,
  );
  if (!schedule?.package_id || !schedule?.course_id)
    throw new Error("Không tìm thấy lịch hoặc Package/Course của dòng preview");
  const packageId = String(schedule.package_id);
  const courseId = String(schedule.course_id);
  const [outline] = await fetchHocmaiCourseOutlines([{ packageId, courseId }]);
  if (!outline?.exists)
    throw new Error(`Không tìm thấy Package ${packageId} / Course ${courseId} trên HOCMAI`);
  return { rowKey, packageId, courseId, lessons: outline.lessons };
};

export const resolveManualHocmaiScormLessons = async (
  programCodeInput: string,
  selectionsInput: HocmaiScormManualSelection[],
  optionsInput: HocmaiScormOptions = {},
): Promise<HocmaiScormManualResolution[]> => {
  const options = parseHocmaiScormOptions(optionsInput);
  const programCode = clean(programCodeInput);
  if (!programCode || !Array.isArray(selectionsInput) || !selectionsInput.length)
    throw new Error("Chương trình hoặc danh sách Lesson cần kiểm tra không hợp lệ");
  if (selectionsInput.length > 200)
    throw new Error("Mỗi lượt chỉ hỗ trợ tối đa 200 Lesson");
  const selections = selectionsInput.map((selection) => ({
    rowKey: clean(selection?.rowKey),
    lessonId: clean(selection?.lessonId),
  }));
  if (selections.some((item) => !item.rowKey || !/^\d+$/.test(item.lessonId)))
    throw new Error("Dòng preview hoặc Lesson ID không hợp lệ");
  if (new Set(selections.map((item) => item.rowKey)).size !== selections.length)
    throw new Error("Danh sách duyệt có dòng preview bị trùng");

  const schedules = await getProgramSchedules(programCode);
  assertTeacherPrefixes(schedules, options);
  const scheduleByKey = new Map(
    schedules.map((row) => [
      `${String(row.calendar_id)}::${row.package_id || ""}::${row.course_id || ""}`,
      row,
    ]),
  );
  const pairs = new Map<string, { packageId: string; courseId: string }>();
  selections.forEach((selection) => {
    const schedule = scheduleByKey.get(selection.rowKey);
    if (!schedule?.package_id || !schedule?.course_id)
      throw new Error(`Không tìm thấy lịch hoặc Package/Course của dòng ${selection.rowKey}`);
    const pair = {
      packageId: String(schedule.package_id),
      courseId: String(schedule.course_id),
    };
    pairs.set(pairKey(pair.packageId, pair.courseId), pair);
  });
  const outlines = await fetchHocmaiCourseOutlines(Array.from(pairs.values()));
  const outlineByPair = new Map(
    outlines.map((outline) => [
      pairKey(outline.packageId, outline.courseId),
      outline,
    ]),
  );

  return selections.map((selection) => {
    const schedule = scheduleByKey.get(selection.rowKey)!;
    const packageId = String(schedule.package_id);
    const courseId = String(schedule.course_id);
    const outline = outlineByPair.get(pairKey(packageId, courseId));
    const candidate = outline?.exists
      ? outline.lessons.find((lesson) => lesson.lessonId === selection.lessonId)
      : undefined;
    if (!candidate)
      throw new Error(
        `Lesson ID ${selection.lessonId} không thuộc Package ${packageId} / Course ${courseId}`,
      );
    const naming = teacherNaming(schedule, candidate, schedules, outline?.lessons || [], options);
    if (!naming.fullNameKnown)
      throw new Error("Thiếu họ tên đầy đủ của giáo viên theo lịch; không thể tạo tên SCORM đầy đủ");
    return {
      rowKey: selection.rowKey,
      lessonId: selection.lessonId,
      currentName: clean(candidate.name),
      suggestedName: naming.suggestedName,
      baseName: naming.baseName,
      teacherName: naming.teacherName,
      honorific: naming.honorific,
      requiresHonorific: naming.requiresHonorific,
      sessionName: clean(candidate.sectionName) || undefined,
      packageId,
      courseId,
    };
  });
};

export const resolveManualHocmaiScormLesson = async (
  programCodeInput: string,
  rowKeyInput: string,
  lessonIdInput: string,
  options: HocmaiScormOptions = {},
): Promise<HocmaiScormManualResolution> => {
  const [resolved] = await resolveManualHocmaiScormLessons(programCodeInput, [{
    rowKey: rowKeyInput,
    lessonId: lessonIdInput,
  }], options);
  return resolved;
};

const resolveManualOverrides = async (
  programCode: string,
  overrides: HocmaiScormManualOverride[],
  options: HocmaiScormOptions,
) => {
  if (overrides.length > 200)
    throw new Error("Mỗi lượt chỉ hỗ trợ tối đa 200 Lesson nhập tay");
  const result = [];
  const targets = new Map<string, string>();
  const resolvedItems = overrides.length
    ? await resolveManualHocmaiScormLessons(
        programCode,
        overrides.map((override) => ({
          rowKey: override.rowKey,
          lessonId: override.lessonId,
        })),
        options,
      )
    : [];
  for (let index = 0; index < overrides.length; index += 1) {
    const override = overrides[index];
    const resolved = resolvedItems[index];
    const expectedName = clean(override.expectedName);
    if (!expectedName || expectedName.length > 255)
      throw new Error(
        `Tên dự kiến của Lesson ${override.lessonId} phải từ 1 đến 255 ký tự`,
      );
    const target = `${resolved.courseId}::${resolved.lessonId}`;
    const prior = targets.get(target);
    if (prior && prior !== expectedName)
      throw new Error(
        `Lesson ${resolved.lessonId} đang có hai tên dự kiến khác nhau`,
      );
    targets.set(target, expectedName);
    result.push({
      course_id: numericId(resolved.courseId, "Course ID"),
      lesson_id: numericId(resolved.lessonId, "Lesson ID"),
      lesson_name: expectedName,
    });
  }
  return Array.from(
    new Map(
      result.map((item) => [`${item.course_id}::${item.lesson_id}`, item]),
    ).values(),
  );
};

const toPayload = (preview: HocmaiScormPreview) =>
  Array.from(
    new Map(
      preview.rows
        .filter(
          (row) =>
            row.status === "update" &&
            row.courseId &&
            row.hocmaiLessonId &&
            row.expectedName,
        )
        .map((row) => [
          `${row.courseId}::${row.hocmaiLessonId}`,
          {
            course_id: numericId(row.courseId!, "Course ID"),
            lesson_id: numericId(row.hocmaiLessonId!, "Lesson ID"),
            lesson_name: row.expectedName!,
          },
        ]),
    ).values(),
  );

const assertDistinctScheduleTargets = (
  preview: HocmaiScormPreview,
  overrides: HocmaiScormManualOverride[],
) => {
  const manual = new Map(overrides.map((item) => [item.rowKey, item.lessonId]));
  const targets = new Map<string, string>();
  for (const row of preview.rows) {
    const id = manual.get(row.key) || (row.status !== "skipped" ? row.hocmaiLessonId : undefined);
    if (!id || !row.packageId || !row.courseId) continue;
    const target = `${row.packageId}::${row.courseId}::${id}`;
    const calendarId = row.key.split("::")[0];
    const prior = targets.get(target);
    if (prior && prior !== calendarId)
      throw new Error(`Lesson ${id} bị chọn cho nhiều lịch trong Package ${row.packageId} / Course ${row.courseId}; cần chọn Lesson ID riêng`);
    targets.set(target, calendarId);
  }
};

const applyPreview = async (
  preview: HocmaiScormPreview,
  manualPayload: Array<{
    course_id: number;
    lesson_id: number;
    lesson_name: string;
  }>,
  onProgress?: (updated: number, total: number) => void,
) => {
  const payloadMap = new Map(
    toPayload(preview).map((item) => [
      `${item.course_id}::${item.lesson_id}`,
      item,
    ]),
  );
  manualPayload.forEach((item) =>
    payloadMap.set(`${item.course_id}::${item.lesson_id}`, item),
  );
  const payload = Array.from(payloadMap.values());
  onProgress?.(0, payload.length);
  if (!payload.length) return { updated: 0, total: 0 };
  const token = clean(process.env.SYNC_SCORM_TOKEN);
  if (!token) throw new Error("Chưa cấu hình SYNC_SCORM_TOKEN");
  const batchSize = Math.min(
    500,
    Math.max(1, Number(process.env.SYNC_SCORM_BATCH_SIZE) || 500),
  );
  let updated = 0;
  for (let index = 0; index < payload.length; index += batchSize) {
    const batch = payload.slice(index, index + batchSize);
    const response = await fetch(
      "https://hocmai.vn/api/live-class/sync-scorm-name",
      {
        method: "POST",
        headers: {
          TOKEN: token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(
          Number(process.env.SYNC_SCORM_TIMEOUT_MS) || 30_000,
        ),
      },
    );
    if (!response.ok)
      throw new Error(`API cập nhật tên SCORM trả HTTP ${response.status}`);
    const text = await response.text();
    if (text.trim()) {
      try {
        JSON.parse(text);
      } catch {
        throw new Error("API cập nhật tên SCORM trả dữ liệu không hợp lệ");
      }
    }
    updated += batch.length;
    onProgress?.(updated, payload.length);
  }
  return { updated, total: payload.length };
};

export type HocmaiScormSyncJob = {
  id: string;
  status: "running" | "completed" | "failed";
  updated: number;
  total: number;
  error?: string;
  completedAt?: number;
};
const jobs = new Map<string, HocmaiScormSyncJob>();
export const startHocmaiScormNameSync = (
  programCode: string,
  overrides: HocmaiScormManualOverride[] = [],
  optionsInput: HocmaiScormOptions = {},
) => {
  const options = parseHocmaiScormOptions(optionsInput);
  const id = crypto.randomUUID();
  const job: HocmaiScormSyncJob = {
    id,
    status: "running",
    updated: 0,
    total: 0,
  };
  jobs.set(id, job);
  void Promise.all([
    previewHocmaiScormNameSync(programCode, options),
    resolveManualOverrides(programCode, overrides, options),
  ])
    .then(([preview, manualPayload]) => {
      assertDistinctScheduleTargets(preview, overrides);
      return applyPreview(preview, manualPayload, (updated, total) => {
        job.updated = updated;
        job.total = total;
      });
    })
    .then(() => {
      job.status = "completed";
      job.completedAt = Date.now();
    })
    .catch((error: any) => {
      logger.error("[HOCMAI SCORM name sync]", error);
      job.status = "failed";
      job.error = clean(error?.message || error) || "Đồng bộ thất bại";
      job.completedAt = Date.now();
    });
  return job;
};
export const getHocmaiScormNameSyncJob = (id: string) => {
  const job = jobs.get(id);
  if (!job) throw new Error("Không tìm thấy tiến trình đồng bộ HOCMAI");
  return job;
};
