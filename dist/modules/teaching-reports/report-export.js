"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.teachingReportWorkbook = void 0;
const XLSX = __importStar(require("xlsx-js-style"));
const roles = { teacher: 'Giáo viên', assistant: 'Trợ giảng' };
const progress = { upcoming: 'Chưa diễn ra', ongoing: 'Đang diễn ra', ended: 'Đã kết thúc theo lịch', cancelled: 'Nghỉ học' };
const modes = { union: 'Gộp giờ trùng theo người và vai trò', per_assignment: 'Cộng theo từng lịch phân công' };
// Lịch đang dùng wall-clock Việt Nam, không dịch thêm múi giờ cho giá trị lịch.
const dateText = (value, time = true) => {
    if (!value)
        return '—';
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isFinite(+date))
        return '—';
    const iso = date.toISOString();
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}${time ? ` ${iso.slice(11, 16)}` : ''}`;
};
const valueText = (value) => value == null || value === '' ? '—' : String(value);
const teachingReportWorkbook = (data) => {
    const numbers = new Map(data.sessions.map((session, index) => [session.id, index + 1]));
    const overlapsText = (row) => row.overlaps.length ? row.overlaps.map(overlap => {
        const examples = overlap.calendars.map(calendar => `Lịch STT ${numbers.get(calendar.id) ?? '—'} · ${calendar.code}: ${dateText(calendar.start_time)} – ${dateText(calendar.end_time)}`).join('; ');
        return `${overlap.name} (${roles[overlap.role] ?? 'Chưa xác định'}): trùng ${overlap.count} lịch. ${examples}${overlap.count > overlap.calendars.length ? `; và ${overlap.count - overlap.calendars.length} lịch khác` : ''}`;
    }).join('\n') : 'Không trùng giờ';
    const stt = { title: 'STT', value: (_, index) => index + 1, width: 8 };
    const personnel = [stt,
        { title: 'Họ và tên', value: row => row.name, width: 28 },
        { title: 'Tài khoản', value: row => row.username },
        { title: 'Vai trò', value: row => roles[row.role] ?? 'Chưa xác định', width: 16 },
        { title: 'Số lịch phân công', value: row => row.assigned },
        { title: 'Số lịch đã kết thúc', value: row => row.ended },
        { title: 'Số lịch chưa diễn ra', value: row => row.upcoming },
        { title: 'Số lịch nghỉ học', value: row => row.cancelled },
        { title: 'Giờ theo lịch', value: row => row.scheduled_hours, hours: true },
        { title: 'Giờ lịch đã kết thúc', value: row => row.ended_hours, hours: true },
        { title: 'Số lịch trùng giờ', value: row => row.overlapping_calendars },
        { title: 'Số chương trình', value: row => row.programs },
        { title: 'Số môn học', value: row => row.subjects },
    ];
    const sessions = [stt,
        { title: 'Mã chương trình', value: row => row.code, width: 28 },
        { title: 'Tên bài học', value: row => valueText(row.lesson_name), width: 45 },
        { title: 'Môn học', value: row => valueText(row.subject) },
        { title: 'Khối', value: row => row.grade == null ? '—' : `Lớp ${row.grade}`, width: 12 },
        { title: 'Bắt đầu theo lịch', value: row => dateText(row.start_time) },
        { title: 'Kết thúc theo lịch', value: row => dateText(row.end_time) },
        { title: 'Thời lượng theo lịch (giờ)', value: row => row.scheduled_seconds / 3600, hours: true },
        { title: 'Tiến độ lịch', value: row => progress[row.progress] ?? 'Chưa xác định', width: 26 },
        { title: 'Giáo viên', value: row => valueText(row.teacher), width: 28 },
        { title: 'Tài khoản giáo viên', value: row => valueText(row.teacher_username) },
        { title: 'Trợ giảng', value: row => valueText(row.assistant_teacher), width: 28 },
        { title: 'Lịch trùng giờ', value: overlapsText, width: 65 },
        { title: 'Cảnh báo', value: row => row.issues.length ? row.issues.join('\n') : 'Không có cảnh báo', width: 40 },
    ];
    const metadata = [stt,
        { title: 'Từ ngày', value: row => dateText(row.from, false), width: 16 },
        { title: 'Đến ngày', value: row => dateText(new Date(+new Date(row.to_exclusive) - 86400000), false), width: 16 },
        { title: 'Múi giờ', value: () => 'Giờ Việt Nam (UTC+7)', width: 24 },
        { title: 'Thời điểm xuất báo cáo', value: row => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(row.generated_at)), width: 28 },
        { title: 'Cơ sở tính thời lượng', value: () => 'Giờ bắt đầu và kết thúc theo lịch; không phải thời gian có mặt thực tế', width: 55 },
        { title: 'Cách tính giờ nhân sự', value: row => modes[row.hours_mode] ?? 'Chưa xác định', width: 40 },
        { title: 'Phạm vi kiểm tra trùng giờ', value: () => 'Cùng người, cùng vai trò trong kết quả lọc; loại lịch nghỉ học', width: 55 },
        { title: 'Số lịch trùng minh họa tối đa mỗi người và vai trò', value: row => row.overlap_examples_limit, width: 28 },
    ];
    const wb = XLSX.utils.book_new();
    for (const { name, rows, columns } of [
        { name: 'Theo nhân sự', rows: data.teachers, columns: personnel },
        { name: 'Lịch giảng dạy', rows: data.sessions, columns: sessions },
        { name: 'Thông tin báo cáo', rows: [data.metadata], columns: metadata },
    ]) {
        // Explicit columns keep headers present even when the report has no rows.
        const sheet = XLSX.utils.aoa_to_sheet([columns.map(column => column.title), ...rows.map((row, index) => columns.map(column => column.value(row, index)))]);
        columns.forEach((column, index) => {
            sheet[XLSX.utils.encode_cell({ r: 0, c: index })].s = {
                font: { bold: true, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: '1677FF' }, patternType: 'solid' },
                alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
            };
        });
        for (const [key, cell] of Object.entries(sheet)) {
            if (key.startsWith('!'))
                continue;
            const position = XLSX.utils.decode_cell(key);
            if (typeof cell.v === 'string') {
                delete cell.f;
                cell.t = 's';
            }
            if (position.r > 0) {
                cell.s = { alignment: { vertical: 'top', wrapText: true } };
                if (columns[position.c].hours)
                    cell.z = '0.00';
            }
        }
        sheet['!cols'] = columns.map(column => ({ wch: column.width ?? 22 }));
        sheet['!rows'] = [{ hpt: 42 }];
        sheet['!autofilter'] = { ref: sheet['!ref'] };
        XLSX.utils.book_append_sheet(wb, sheet, name);
    }
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
exports.teachingReportWorkbook = teachingReportWorkbook;
