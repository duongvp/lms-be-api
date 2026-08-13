import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeQuizAnswers,
  validateQuizAnswers,
  validateQuizBulkPayload,
  validateQuizImportRows,
  validateQuizListQuery,
  validateQuizPayload,
  validateQuizReorderPayload,
} from '../src/modules/quizzes/quiz.validation';
import {
  buildQuizCsvBuffer,
  buildQuizTemplateBuffer,
  parseQuizImportFile,
} from '../src/modules/quizzes/quiz.io';

test('normalizeQuizAnswers accepts legacy JSON strings', () => {
  assert.deepEqual(normalizeQuizAnswers('[{"A":true,"text":"4"}]'), [{ A: true, text: '4' }]);
});

test('validates and normalizes a multiple-choice payload', () => {
  const payload = validateQuizPayload({
    code: 'toan-7-2027',
    learn_number: 10,
    quiz_type: 1,
    quiz_name: '2 + 2 bằng bao nhiêu?',
    ans: [{ A: 0, text: '3' }, { B: 'true', text: '4' }],
    score_type: 1,
    ans_duration: 60,
    quiz_status: 'done',
    quiz_index: 0,
  }) as any;
  assert.deepEqual(payload.ans, [{ A: false, text: '3' }, { B: true, text: '4' }]);
});

test('rejects multiple-choice questions without a correct answer', () => {
  assert.throws(
    () => validateQuizAnswers(1, [{ A: false, text: 'A' }, { B: false, text: 'B' }]),
    /ít nhất một đáp án đúng/
  );
});

test('normalizes fill-in answers and default placeholders', () => {
  assert.deepEqual(validateQuizAnswers(2, [{ text: 'Hà Nội' }]), [
    { placeholder: 'Chỗ trống 1', text: 'Hà Nội', A: true },
  ]);
});

test('rejects mass-assignment fields', () => {
  assert.throws(
    () => validateQuizPayload({ creator: 'spoofed' }, true),
    /Trường không được hỗ trợ: creator/
  );
});

test('validates list bounds and sort whitelist', () => {
  assert.throws(() => validateQuizListQuery({ limit: 101 }), /1-100/);
  assert.throws(() => validateQuizListQuery({ sort_by: 'DROP TABLE quiz_content' }), /sort_by/);
  assert.deepEqual(validateQuizListQuery({ page: '2', sort_order: 'descend' }).page, 2);
});

test('rejects duplicate reorder ids and unsupported bulk fields', () => {
  assert.throws(
    () => validateQuizReorderPayload({ code: 'a', learn_number: 1, ordered_quiz_ids: ['q1', 'q1'] }),
    /không được trùng/
  );
  assert.throws(
    () => validateQuizBulkPayload({ quiz_ids: ['q1'], data: { quiz_name: 'unsafe' } }),
    /Không hỗ trợ bulk field/
  );
});

test('CSV export can be parsed back into an import row', () => {
  const buffer = buildQuizCsvBuffer([{
    quiz_id: 'q-1',
    code: 'toan-7-2027',
    learn_number: 10,
    quiz_index: 1,
    quiz_name: 'Câu hỏi, có dấu phẩy',
    quiz_type: 1,
    ans: [{ A: true, text: 'Đúng' }, { B: false, text: 'Sai' }],
    score_type: 1,
    ans_duration: 60,
    quiz_status: 'done',
  }]);
  const [row] = parseQuizImportFile(buffer, 'quiz.csv');
  assert.equal(row.quiz_id, 'q-1');
  assert.equal(row.quiz_name, 'Câu hỏi, có dấu phẩy');
  assert.match(String(row.ans), /"A":true/);
});

test('friendly template can be imported without JSON knowledge', () => {
  const rows = parseQuizImportFile(buildQuizTemplateBuffer('csv'), 'mau-import-cau-hoi.csv');
  assert.equal(rows.length, 3);
  assert.equal(rows[0].quiz_type, 1);
  assert.equal(rows[0].quiz_status, 'done');
  assert.deepEqual(rows[0].ans, [
    { A: false, text: '3' },
    { B: true, text: '4' },
    { C: false, text: '5' },
  ]);
  assert.equal(rows[1].quiz_type, 2);
  assert.deepEqual(rows[1].ans, [{ placeholder: 'Tên thủ đô', text: 'Hà Nội; Ha Noi', A: true }]);
  assert.equal(rows[2].quiz_type, 3);
  assert.equal(rows[2].quiz_status, 'done');
  // Controller gắn code của Chương trình đã chọn trước khi validate file import.
  const validated = validateQuizImportRows(rows.map((row) => ({
    ...row,
    code: 'toan-7-2027',
  })));
  assert.equal(validated.errors.length, 0);
  assert.equal(validated.validRows.length, 3);
});

test('friendly import supports multiple-choice columns through Z', () => {
  const csv = [
    'Mã lớp,Buổi học,Thứ tự,Câu hỏi,Loại câu hỏi,Lựa chọn A,Lựa chọn B,Lựa chọn C,Lựa chọn D,Lựa chọn E,Đáp án đúng,Cách tính điểm,Thời gian (giây),Trạng thái',
    'toan-7-2027,10,4,Chọn các số chẵn,Trắc nghiệm,1,2,3,4,6,B;D;E,Toàn câu,60,0',
  ].join('\n');
  const [row] = parseQuizImportFile(Buffer.from(`\uFEFF${csv}`, 'utf8'), 'quiz.csv');
  assert.equal((row.ans as any[]).length, 5);
  assert.deepEqual(row.ans, [
    { A: false, text: '1' },
    { B: true, text: '2' },
    { C: false, text: '3' },
    { D: true, text: '4' },
    { E: true, text: '6' },
  ]);
  assert.equal(row.quiz_status, 'disable');
  assert.equal(validateQuizImportRows([row]).errors.length, 0);
});
