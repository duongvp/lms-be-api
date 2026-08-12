type AutoScheduleSession = {
  weekday: number;
  start_time: string;
  end_time: string;
  teacher?: string;
  assistant_teacher?: string;
  room?: string;
  lesson_id?: string;
  hmo_mappings?: Array<{
    package_id: string;
    course_id: string;
    lesson_id: string;
  }>;
};

type AutoScheduleLesson = {
  learn_number: number;
  session_id?: string | number;
  lesson_name?: string;
  sessions: AutoScheduleSession[];
};

type AutoScheduleBlock = Partial<AutoScheduleLesson> & {
  block_name?: string;
  lessons?: AutoScheduleLesson[];
  sessions?: AutoScheduleSession[];
};

export type AutoSchedulePayload = {
  program_code: string;
  system_type: 'topclass' | 'topuni';
  start_date: string;
  strategy?: 'by_block' | 'interleaved';
  holidays?: string[];
  customize_lesson_names?: boolean;
  lesson_name_prefix?: string;
  lesson_name_suffix?: string;
  lesson_name_rules?: Array<{
    from_learn_number: number;
    to_learn_number: number;
    prefix?: string;
    suffix?: string;
  }>;
  blocks: AutoScheduleBlock[];
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const dateOnly = (date: Date) => [
  date.getFullYear(),
  String(date.getMonth() + 1).padStart(2, '0'),
  String(date.getDate()).padStart(2, '0'),
].join('-');

const parseDateOnly = (value: string) => {
  if (!DATE_PATTERN.test(value)) throw new Error('start_date phải có định dạng YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (dateOnly(result) !== value) throw new Error('start_date không hợp lệ');
  return result;
};

const combineDateTime = (date: Date, time: string) => {
  if (!TIME_PATTERN.test(time)) throw new Error(`Giờ học ${time} không hợp lệ`);
  const [hour, minute] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, 0, 0);
  return result;
};

const formatCalendarWallTime = (date: Date) => (
  `${dateOnly(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:00.000Z`
);

const renderNamePattern = (pattern: string, occurrence: number) => (
  pattern.replaceAll('{n}', String(occurrence))
);

const normalizeLessonNameRules = (rules: AutoSchedulePayload['lesson_name_rules']) => {
  const normalized = (rules || []).map((rule, index) => {
    const from = Number(rule?.from_learn_number);
    const to = Number(rule?.to_learn_number);
    if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to < from) {
      throw new Error(`Khoảng bài thứ ${index + 1} không hợp lệ`);
    }
    return {
      from_learn_number: from,
      to_learn_number: to,
      prefix: String(rule?.prefix || '').slice(0, 100),
      suffix: String(rule?.suffix || '').slice(0, 100),
    };
  }).sort((left, right) => left.from_learn_number - right.from_learn_number);

  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].from_learn_number <= normalized[index - 1].to_learn_number) {
      throw new Error('Các khoảng bài áp dụng tiền tố/hậu tố không được chồng lấn');
    }
  }
  return normalized;
};

const lessonsOf = (block: AutoScheduleBlock): AutoScheduleLesson[] => {
  if (Array.isArray(block.lessons) && block.lessons.length) return block.lessons;
  // Tương thích payload cũ: một Block chính là một bài.
  if (block.learn_number && Array.isArray(block.sessions)) {
    return [{
      learn_number: block.learn_number,
      session_id: block.session_id,
      lesson_name: block.lesson_name,
      sessions: block.sessions,
    }];
  }
  return [];
};

const orderedSessions = (blocks: AutoScheduleBlock[], strategy: string, maxSessionsPerLesson?: number) => {
  const result: Array<{
    block: AutoScheduleBlock;
    lesson: AutoScheduleLesson;
    session: AutoScheduleSession;
  }> = [];

  const sessionsOfLesson = (lesson: AutoScheduleLesson) => (
    maxSessionsPerLesson ? lesson.sessions.slice(0, maxSessionsPerLesson) : lesson.sessions
  );
  const normalizedBlocks = blocks.map((block) => ({ block, lessons: lessonsOf(block) }));
  if (
    strategy === 'interleaved'
    && normalizedBlocks.every(({ lessons }) => lessons.length === 1)
  ) {
    const maximum = Math.max(...normalizedBlocks.map(({ lessons }) => sessionsOfLesson(lessons[0]).length));
    for (let sessionIndex = 0; sessionIndex < maximum; sessionIndex += 1) {
      normalizedBlocks.forEach(({ block, lessons }) => {
        const lesson = lessons[0];
        const session = sessionsOfLesson(lesson)[sessionIndex];
        if (session) result.push({ block, lesson, session });
      });
    }
    return result;
  }

  normalizedBlocks.forEach(({ block, lessons }) => {
    if (strategy !== 'interleaved') {
      lessons.forEach((lesson) => sessionsOfLesson(lesson).forEach((session) => {
        result.push({ block, lesson, session });
      }));
      return;
    }

    // Xen kẽ bên trong từng Block cặp: Bài 1/buổi 1 -> Bài 2/buổi 1
    // -> Bài 1/buổi 2 -> Bài 2/buổi 2, rồi mới sang Block tiếp theo.
    const maximum = Math.max(...lessons.map((lesson) => sessionsOfLesson(lesson).length));
    for (let sessionIndex = 0; sessionIndex < maximum; sessionIndex += 1) {
      lessons.forEach((lesson) => {
        const session = sessionsOfLesson(lesson)[sessionIndex];
        if (session) result.push({ block, lesson, session });
      });
    }
  });
  return result;
};

const nextStudyDate = (
  cursor: Date,
  weekday: number,
  holidays: Set<string>
) => {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new Error('weekday phải nằm trong khoảng 1 (Thứ 2) đến 7 (Chủ nhật)');
  }
  const targetJsDay = weekday === 7 ? 0 : weekday;
  const candidate = new Date(cursor);
  for (let offset = 0; offset < 3660; offset += 1) {
    if (candidate.getDay() === targetJsDay && !holidays.has(dateOnly(candidate))) {
      return candidate;
    }
    candidate.setDate(candidate.getDate() + 1);
  }
  throw new Error('Không tìm được ngày học hợp lệ trong phạm vi 10 năm');
};

export const previewAutoSchedule = (payload: AutoSchedulePayload) => {
  const programCode = String(payload?.program_code || '').trim();
  if (!programCode) throw new Error('Vui lòng chọn Chương trình');
  if (!['topclass', 'topuni'].includes(payload?.system_type)) {
    throw new Error('system_type chỉ hỗ trợ topclass hoặc topuni');
  }
  if (!Array.isArray(payload?.blocks) || !payload.blocks.length) {
    throw new Error('Cần ít nhất một Block để tạo lịch');
  }
  if (payload.blocks.some((block) => !lessonsOf(block).length)) {
    throw new Error('Mỗi Block phải có ít nhất một bài học');
  }
  if (payload.blocks.some((block) => lessonsOf(block).some(
    (lesson) => !Array.isArray(lesson.sessions) || !lesson.sessions.length
  ))) {
    throw new Error('Mỗi bài trong Block phải có ít nhất một buổi học');
  }
  const holidays = new Set((payload.holidays || []).map((value) => {
    if (!DATE_PATTERN.test(value)) throw new Error(`Ngày nghỉ ${value} không hợp lệ`);
    return value;
  }));
  const sequence = orderedSessions(
    payload.blocks,
    payload.strategy || 'by_block',
    payload.system_type === 'topuni' ? 1 : undefined
  );
  let cursor = parseDateOnly(payload.start_date);
  const lessonOccurrences = new Map<string, number>();
  const customizeLessonNames = Boolean(payload.customize_lesson_names);
  const lessonNamePrefix = String(payload.lesson_name_prefix || '').slice(0, 100);
  const lessonNameSuffix = String(payload.lesson_name_suffix || '').slice(0, 100);
  const lessonNameRules = normalizeLessonNameRules(payload.lesson_name_rules);

  const calendars = sequence.map(({ block, lesson, session }, index) => {
    if (!Number.isInteger(lesson.learn_number) || lesson.learn_number <= 0) {
      throw new Error(`Block ${index + 1} có learn_number không hợp lệ`);
    }
    const studyDate = nextStudyDate(cursor, Number(session.weekday), holidays);
    const startTime = combineDateTime(studyDate, session.start_time);
    const endTime = combineDateTime(studyDate, session.end_time);
    if (endTime <= startTime) throw new Error('Giờ kết thúc phải sau giờ bắt đầu');
    cursor = new Date(studyDate);
    cursor.setDate(cursor.getDate() + 1);
    const lessonKey = lesson.session_id == null
      ? `learn:${lesson.learn_number}`
      : `id:${String(lesson.session_id)}`;
    const occurrence = (lessonOccurrences.get(lessonKey) || 0) + 1;
    lessonOccurrences.set(lessonKey, occurrence);
    const masterLessonName = String(lesson.lesson_name || '');
    const lessonNameRule = lessonNameRules.find((rule) => (
      lesson.learn_number >= rule.from_learn_number && lesson.learn_number <= rule.to_learn_number
    ));
    const prefix = lessonNameRule?.prefix ?? lessonNamePrefix;
    const suffix = lessonNameRule?.suffix ?? lessonNameSuffix;
    // Khoảng bài chỉ quyết định dùng bộ tiền tố/hậu tố nào. Tất cả mẫu tên
    // (riêng hoặc chung) đều chỉ áp dụng từ buổi thứ hai của từng bài.
    const shouldApplyNamePattern = customizeLessonNames && occurrence > 1;
    const lessonName = shouldApplyNamePattern
      ? `${renderNamePattern(prefix, occurrence)}${masterLessonName}${renderNamePattern(suffix, occurrence)}`.slice(0, 400)
      : masterLessonName;

    return {
      system_type: payload.system_type,
      code: programCode,
      learn_number: lesson.learn_number,
      session_id: lesson.session_id,
      lesson_name: lessonName,
      teacher: session.teacher,
      assistant_teacher: session.assistant_teacher,
      room: session.room,
      start_time: formatCalendarWallTime(startTime),
      end_time: formatCalendarWallTime(endTime),
      lesson_status: 0,
      package_lesson_mappings: (session.hmo_mappings || []).map((mapping) => ({
        package_ids: [mapping.package_id],
        course_id: mapping.course_id,
        lesson_ids: [mapping.lesson_id],
      })),
      auto_schedule: {
        block_index: payload.blocks.indexOf(block),
        lesson_index: lessonsOf(block).indexOf(lesson),
        session_index: lesson.sessions.indexOf(session),
        hmo_section_id: session.lesson_id,
      },
    };
  });

  return {
    program_code: programCode,
    strategy: payload.strategy || 'by_block',
    holidays: [...holidays],
    count: calendars.length,
    calendars,
  };
};
