import * as XLSX from 'xlsx';
import { QuizExportFormat } from './quiz.types';

type Column = { key: string; header: string };

export const QUIZ_EXPORT_COLUMNS: Column[] = [
  { key: 'quiz_id', header: 'Mã quiz' },
  { key: 'learn_number', header: 'Bài học' },
  { key: 'quiz_index', header: 'Thứ tự' },
  { key: 'quiz_name', header: 'Câu hỏi' },
  { key: 'quiz_type', header: 'Loại câu hỏi' },
  { key: 'answer_summary', header: 'Đáp án dễ đọc' },
  { key: 'ans', header: 'Đáp án JSON' },
  { key: 'score_type', header: 'Cách tính điểm' },
  { key: 'ans_duration', header: 'Thời gian (giây)' },
  { key: 'quiz_status', header: 'Trạng thái (1: Đã hoàn thiện, 0: Đã vô hiệu hóa)' },
  { key: 'creator', header: 'Người tạo' },
  { key: 'created_at', header: 'Ngày tạo' },
  { key: 'updated_at', header: 'Ngày cập nhật' },
];

const HEADER_ALIASES: Record<string, string> = {
  quiz_id: 'quiz_id',
  'mã quiz': 'quiz_id',
  'ma quiz': 'quiz_id',
  code: 'code',
  'mã lớp': 'code',
  'ma lop': 'code',
  learn_number: 'learn_number',
  'buổi học': 'learn_number',
  'buoi hoc': 'learn_number',
  'bài học': 'learn_number',
  'bai hoc': 'learn_number',
  quiz_index: 'quiz_index',
  'thứ tự': 'quiz_index',
  'thu tu': 'quiz_index',
  quiz_name: 'quiz_name',
  'câu hỏi': 'quiz_name',
  'cau hoi': 'quiz_name',
  quiz_type: 'quiz_type',
  'loại câu hỏi': 'quiz_type',
  'loai cau hoi': 'quiz_type',
  ans: 'ans',
  'đáp án json': 'ans',
  'dap an json': 'ans',
  score_type: 'score_type',
  'cách tính điểm': 'score_type',
  'cach tinh diem': 'score_type',
  ans_duration: 'ans_duration',
  'thời gian (giây)': 'ans_duration',
  'thoi gian (giay)': 'ans_duration',
  quiz_status: 'quiz_status',
  'trạng thái': 'quiz_status',
  'trang thai': 'quiz_status',
  'trạng thái (1: đã hoàn thiện, 0: đã vô hiệu hóa)': 'quiz_status',
  'trang thai (1: da hoan thien, 0: da vo hieu hoa)': 'quiz_status',
  'status (1: hoạt động, 0: ngừng hoạt động)': 'quiz_status',
  'status (1: hoat dong, 0: ngung hoat dong)': 'quiz_status',
  'status (1: hoạt động, 2: ngừng hoạt động)': 'quiz_status',
  'status (1: hoat dong, 2: ngung hoat dong)': 'quiz_status',
  'lựa chọn a': 'answer_a',
  'lua chon a': 'answer_a',
  'lựa chọn b': 'answer_b',
  'lua chon b': 'answer_b',
  'lựa chọn c': 'answer_c',
  'lua chon c': 'answer_c',
  'lựa chọn d': 'answer_d',
  'lua chon d': 'answer_d',
  'đáp án đúng': 'correct_answers',
  'dap an dung': 'correct_answers',
  'đáp án đúng (vd: b hoặc a;c;f)': 'correct_answers',
  'dap an dung (vd: b hoac a;c;f)': 'correct_answers',
  'gợi ý ô trống': 'fill_placeholder',
  'goi y o trong': 'fill_placeholder',
  'đáp án điền từ': 'fill_answers',
  'dap an dien tu': 'fill_answers',
  'đáp án trả lời ngắn': 'short_answer',
  'dap an tra loi ngan': 'short_answer',
};

const normalizeHeader = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('vi-VN');

const normalizeFriendlyQuizType = (value: unknown) => {
  const text = normalizeHeader(value);
  if (['1', 'trắc nghiệm', 'trac nghiem'].includes(text)) return 1;
  if (['2', 'điền từ', 'dien tu'].includes(text)) return 2;
  if (['3', 'trả lời ngắn', 'tra loi ngan'].includes(text)) return 3;
  return value;
};

const normalizeFriendlyScoreType = (value: unknown) => {
  const text = normalizeHeader(value);
  if (['1', 'toàn câu', 'toan cau', 'tính điểm toàn câu', 'tinh diem toan cau'].includes(text)) return 1;
  if (['2', 'theo ý', 'theo y', 'tính điểm theo ý', 'tinh diem theo y'].includes(text)) return 2;
  return value;
};

const normalizeFriendlyStatus = (value: unknown) => {
  const text = normalizeHeader(value);
  // Nhận diện giá trị cũ khi import nhưng chuẩn hóa về một trong hai trạng thái hiện hành.
  if (['1', 'active', 'đang hoạt động', 'dang hoat dong', 'hoạt động', 'hoat dong'].includes(text)) return 'done';
  if (['done', 'đã hoàn thiện', 'da hoan thien'].includes(text)) return 'done';
  if (['0', '2', 'disable', 'đã vô hiệu hóa', 'da vo hieu hoa', 'ngừng hoạt động', 'ngung hoat dong'].includes(text)) return 'disable';
  return value;
};

const buildFriendlyAnswers = (row: Record<string, unknown>, quizType: unknown) => {
  if (row.ans !== undefined && String(row.ans).trim()) return row.ans;
  if (quizType === 1) {
    const correct = new Set(
      String(row.correct_answers ?? '')
        .toUpperCase()
        .split(/[;,|\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    );
    return Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))
      .map((letter) => ({
        letter,
        text: String(row[`answer_${letter.toLowerCase()}`] ?? '').trim(),
      }))
      .filter((item) => item.text)
      .map((item) => ({ [item.letter]: correct.has(item.letter), text: item.text }));
  }
  if (quizType === 2) {
    return [{
      placeholder: String(row.fill_placeholder ?? '').trim(),
      text: String(row.fill_answers ?? '').trim(),
      A: true,
    }];
  }
  if (quizType === 3) {
    return [{ A: true, text: String(row.short_answer ?? '').trim() }];
  }
  return row.ans;
};

const normalizeRows = (rows: Record<string, unknown>[]) => rows.map((row) => {
  const normalized: Record<string, unknown> = {};
  Object.entries(row).forEach(([header, value]) => {
    const normalizedHeader = normalizeHeader(header);
    const dynamicAnswerColumn = normalizedHeader.match(/^(?:lựa chọn|lua chon) ([a-z])$/);
    const key = HEADER_ALIASES[normalizedHeader]
      ?? (dynamicAnswerColumn ? `answer_${dynamicAnswerColumn[1]}` : undefined);
    if (key) normalized[key] = value;
  });
  normalized.quiz_type = normalizeFriendlyQuizType(normalized.quiz_type);
  normalized.score_type = normalizeFriendlyScoreType(normalized.score_type);
  normalized.quiz_status = normalizeFriendlyStatus(normalized.quiz_status);
  normalized.ans = buildFriendlyAnswers(normalized, normalized.quiz_type);
  return normalized;
});

const serializeAnswer = (value: unknown) => {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? []);
};

const quizTypeLabel = (value: unknown) => ({
  1: 'Trắc nghiệm',
  2: 'Điền từ',
  3: 'Trả lời ngắn',
}[Number(value) as 1 | 2 | 3] ?? value);

const scoreTypeLabel = (value: unknown) => ({
  1: 'Toàn câu',
  2: 'Theo ý',
}[Number(value) as 1 | 2] ?? value);

const statusExportValue = (value: unknown) => (
  String(value) === 'disable' ? 0 : 1
);

const answerSummary = (row: any) => {
  const answers = Array.isArray(row.ans) ? row.ans : [];
  if (Number(row.quiz_type) === 1) {
    return answers.map((answer: Record<string, unknown>, index: number) => {
      const letter = String.fromCharCode(65 + index);
      return `${letter}. ${String(answer.text ?? '')}${answer[letter] ? ' (Đúng)' : ''}`;
    }).join(' | ');
  }
  if (Number(row.quiz_type) === 2) {
    return answers.map((answer: Record<string, unknown>) => (
      `${String(answer.placeholder ?? 'Ô trống')}: ${String(answer.text ?? '')}`
    )).join(' | ');
  }
  return String(answers[0]?.text ?? '');
};

const toExportRow = (row: any) => Object.fromEntries(
  QUIZ_EXPORT_COLUMNS.map(({ key, header }) => [
    header,
    key === 'ans' ? serializeAnswer(row[key])
      : key === 'answer_summary' ? answerSummary(row)
        : key === 'quiz_type' ? quizTypeLabel(row[key])
          : key === 'score_type' ? scoreTypeLabel(row[key])
            : key === 'quiz_status' ? statusExportValue(row[key])
              : (row[key] ?? ''),
  ])
);

const escapeCsv = (value: unknown) => {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const buildQuizCsvBuffer = (rows: any[]) => {
  const exported = rows.map(toExportRow);
  const headers = QUIZ_EXPORT_COLUMNS.map((column) => column.header);
  const lines = [
    headers.map(escapeCsv).join(','),
    ...exported.map((row) => headers.map((header) => escapeCsv(row[header])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
};

export const buildQuizWorkbookBuffer = (rows: any[]) => {
  const worksheet = XLSX.utils.json_to_sheet(rows.map(toExportRow), {
    header: QUIZ_EXPORT_COLUMNS.map((column) => column.header),
  });
  worksheet['!cols'] = QUIZ_EXPORT_COLUMNS.map(({ key, header }) => ({
    wch: key === 'quiz_name' || key === 'ans' || key === 'answer_summary' ? 55 : Math.max(14, header.length + 2),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Quizzes');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const TEMPLATE_ANSWER_HEADERS = Array.from(
  { length: 8 },
  (_, index) => `Lựa chọn ${String.fromCharCode(65 + index)}`
);

const TEMPLATE_HEADERS = [
  'Mã quiz', 'Bài học', 'Thứ tự', 'Câu hỏi', 'Loại câu hỏi',
  ...TEMPLATE_ANSWER_HEADERS, 'Đáp án đúng (VD: B hoặc A;C;F)',
  'Gợi ý ô trống', 'Đáp án điền từ', 'Đáp án trả lời ngắn',
  'Cách tính điểm', 'Thời gian (giây)', 'Trạng thái (1: Đã hoàn thiện, 0: Đã vô hiệu hóa)',
  'Hướng dẫn theo loại (không nhập)',
];

const templateRows = [
  {
    'Mã quiz': '', 'Bài học': 10, 'Thứ tự': 1,
    'Câu hỏi': 'Kết quả của 2 + 2 là?', 'Loại câu hỏi': 'Trắc nghiệm',
    'Lựa chọn A': '3', 'Lựa chọn B': '4', 'Lựa chọn C': '5', 'Lựa chọn D': '',
    'Lựa chọn E': '', 'Lựa chọn F': '', 'Lựa chọn G': '', 'Lựa chọn H': '',
    'Đáp án đúng (VD: B hoặc A;C;F)': 'B', 'Gợi ý ô trống': '', 'Đáp án điền từ': '',
    'Đáp án trả lời ngắn': '', 'Cách tính điểm': 'Toàn câu',
    'Thời gian (giây)': 60, 'Trạng thái (1: Đã hoàn thiện, 0: Đã vô hiệu hóa)': 1,
    'Hướng dẫn theo loại (không nhập)': 'Nhập từ A đến đáp án cuối. Một đáp án đúng: B. Nhiều đáp án đúng: A;C;F.',
  },
  {
    'Mã quiz': '', 'Bài học': 10, 'Thứ tự': 2,
    'Câu hỏi': 'Thủ đô Việt Nam là _____.', 'Loại câu hỏi': 'Điền từ',
    'Lựa chọn A': '', 'Lựa chọn B': '', 'Lựa chọn C': '', 'Lựa chọn D': '',
    'Lựa chọn E': '', 'Lựa chọn F': '', 'Lựa chọn G': '', 'Lựa chọn H': '',
    'Đáp án đúng (VD: B hoặc A;C;F)': '', 'Gợi ý ô trống': 'Tên thủ đô', 'Đáp án điền từ': 'Hà Nội; Ha Noi',
    'Đáp án trả lời ngắn': '', 'Cách tính điểm': 'Toàn câu',
    'Thời gian (giây)': 60, 'Trạng thái (1: Đã hoàn thiện, 0: Đã vô hiệu hóa)': 1,
    'Hướng dẫn theo loại (không nhập)': 'Nhập gợi ý và các cách viết được chấp nhận; phân tách đáp án bằng dấu ;',
  },
  {
    'Mã quiz': '', 'Bài học': 10, 'Thứ tự': 3,
    'Câu hỏi': 'Em hãy nêu công thức tính diện tích hình chữ nhật.', 'Loại câu hỏi': 'Trả lời ngắn',
    'Lựa chọn A': '', 'Lựa chọn B': '', 'Lựa chọn C': '', 'Lựa chọn D': '',
    'Lựa chọn E': '', 'Lựa chọn F': '', 'Lựa chọn G': '', 'Lựa chọn H': '',
    'Đáp án đúng (VD: B hoặc A;C;F)': '', 'Gợi ý ô trống': '', 'Đáp án điền từ': '',
    'Đáp án trả lời ngắn': 'Chiều dài nhân chiều rộng', 'Cách tính điểm': 'Toàn câu',
    'Thời gian (giây)': 120, 'Trạng thái (1: Đã hoàn thiện, 0: Đã vô hiệu hóa)': 1,
    'Hướng dẫn theo loại (không nhập)': 'Chỉ nhập nội dung vào cột Đáp án trả lời ngắn.',
  },
];

const buildFriendlyTemplateCsv = () => {
  const lines = [
    TEMPLATE_HEADERS.map(escapeCsv).join(','),
    ...templateRows.map((row) => TEMPLATE_HEADERS.map((header) => escapeCsv(row[header as keyof typeof row])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\n')}`, 'utf8');
};

const buildFriendlyTemplateWorkbook = () => {
  const dataSheet = XLSX.utils.json_to_sheet(templateRows, { header: TEMPLATE_HEADERS });
  dataSheet['!cols'] = TEMPLATE_HEADERS.map((header) => ({
    wch: ['Câu hỏi', 'Đáp án điền từ', 'Đáp án trả lời ngắn'].includes(header) ? 42 : Math.max(14, header.length + 2),
  }));
  const lastTemplateColumn = XLSX.utils.encode_col(TEMPLATE_HEADERS.length - 1);
  dataSheet['!autofilter'] = { ref: `A1:${lastTemplateColumn}${templateRows.length + 1}` };

  const guideRows = [
    ['HƯỚNG DẪN NHẬP CÂU HỎI'],
    ['Cột / nội dung', 'Cách nhập', 'Ví dụ'],
    ['Mỗi dòng', 'Một dòng tương ứng một câu hỏi. Sửa hoặc xóa 3 dòng mẫu trước khi nhập dữ liệu thật.', ''],
    ['Mã quiz', 'Tạo mới: để trống. Cập nhật: giữ đúng mã lấy từ file xuất.', 'Để trống'],
    ['Loại câu hỏi', 'Chỉ nhập một trong ba giá trị.', 'Trắc nghiệm / Điền từ / Trả lời ngắn'],
    ['Trắc nghiệm', 'Nhập liên tục từ Lựa chọn A. Có sẵn A-H; có thể thêm cột Lựa chọn I... đến Z.', 'A, B, C, D, E...'],
    ['Đáp án đúng', 'Một đáp án nhập một chữ cái. Nhiều đáp án phân tách bằng dấu chấm phẩy (;).', 'B hoặc A;C;F'],
    ['Điền từ', 'Nhập Gợi ý ô trống và Đáp án điền từ. Nhiều cách viết chấp nhận được phân tách bằng dấu ;', 'Hà Nội; Ha Noi'],
    ['Trả lời ngắn', 'Nhập nội dung vào cột Đáp án trả lời ngắn.', 'Chiều dài nhân chiều rộng'],
    ['Cách tính điểm', 'Chỉ nhập Toàn câu hoặc Theo ý.', 'Toàn câu'],
    ['Thời gian', 'Nhập số giây từ 1 đến 3600.', '60'],
    ['Status', 'Nhập 1 nếu hoạt động, nhập 0 nếu ngừng hoạt động.', '1'],
    ['Thứ tự', 'Hệ thống tự xếp khi tạo mới; chỉ thay đổi bằng chức năng Sắp xếp.', '1, 2, 3...'],
    ['Kiểm tra file', 'Nếu có một dòng lỗi thì hệ thống chưa lưu bất kỳ dòng nào.', 'Sửa lỗi rồi nhập lại'],
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(guideRows);
  guideSheet['!cols'] = [{ wch: 24 }, { wch: 85 }, { wch: 38 }];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Nhập câu hỏi');
  XLSX.utils.book_append_sheet(workbook, guideSheet, 'Hướng dẫn');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

export const buildQuizTemplateBuffer = (format: QuizExportFormat) => (
  format === 'csv' ? buildFriendlyTemplateCsv() : buildFriendlyTemplateWorkbook()
);

export const buildQuizExportBuffer = (rows: any[], format: QuizExportFormat) => (
  format === 'csv' ? buildQuizCsvBuffer(rows) : buildQuizWorkbookBuffer(rows)
);

export const parseQuizImportFile = (buffer: Buffer, originalName: string) => {
  const extension = originalName.split('.').pop()?.toLowerCase();
  if (extension !== 'xlsx' && extension !== 'csv') return [];
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
    defval: '',
    blankrows: false,
    raw: false,
  });
  return normalizeRows(rows);
};

export const getQuizExportContentType = (format: QuizExportFormat) => (
  format === 'csv'
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
);
