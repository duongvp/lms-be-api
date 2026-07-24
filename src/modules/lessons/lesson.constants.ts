export const SUBJECT_OPTIONS = [
  { subject_name: 'Toán', subject_code: 'TOAN' },
  { subject_name: 'Ngữ văn', subject_code: 'VAN' },
  { subject_name: 'Tiếng Anh', subject_code: 'ANH' },
  { subject_name: 'Vật lý', subject_code: 'LY' },
  { subject_name: 'Hóa học', subject_code: 'HOA' },
  { subject_name: 'Sinh học', subject_code: 'SINH' },
  { subject_name: 'Lịch sử', subject_code: 'SU' },
  { subject_name: 'Địa lý', subject_code: 'DIA' },
  { subject_name: 'GDCD', subject_code: 'GDCD' },
  { subject_name: 'Tin học', subject_code: 'TIN' },
  { subject_name: 'Công nghệ', subject_code: 'CONGNGHE' },
];

const normalizeSubject = (value: string) => value
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D')
  .replace(/^(mon|subject)\s+/i, '')
  .replace(/\s+/g, '')
  .toLocaleLowerCase('vi-VN');

const levenshteinDistance = (source: string, target: string) => {
  const matrix = Array.from({ length: source.length + 1 }, (_, index) => [index]);
  for (let index = 1; index <= target.length; index += 1) matrix[0][index] = index;

  for (let row = 1; row <= source.length; row += 1) {
    for (let col = 1; col <= target.length; col += 1) {
      const cost = source[row - 1] === target[col - 1] ? 0 : 1;
      matrix[row][col] = Math.min(
        matrix[row - 1][col] + 1,
        matrix[row][col - 1] + 1,
        matrix[row - 1][col - 1] + cost
      );
    }
  }

  return matrix[source.length][target.length];
};

export const resolveSubject = (subjectName: string) => {
  const normalized = normalizeSubject(subjectName);
  const exact = SUBJECT_OPTIONS.find((subject) => (
    normalizeSubject(subject.subject_name) === normalized ||
    normalizeSubject(subject.subject_code) === normalized
  ));
  if (exact) return exact;

  const fuzzyMatches = SUBJECT_OPTIONS.filter((subject) => {
    const normalizedName = normalizeSubject(subject.subject_name);
    return normalized.length >= 3 && levenshteinDistance(normalized, normalizedName) <= 1;
  });

  return fuzzyMatches.length === 1 ? fuzzyMatches[0] : undefined;
};

export const resolveSubjectCode = (subjectName: string) => {
  return resolveSubject(subjectName)?.subject_code;
};
