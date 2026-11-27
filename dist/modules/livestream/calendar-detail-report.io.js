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
exports.buildRestrictionWorkbook = exports.buildDetailWorkbook = void 0;
const XLSX = __importStar(require("xlsx-js-style"));
const attendance = { attended: 'Đủ chuyên cần', observed: 'Có ghi nhận, chưa đủ', unobserved: 'Chưa có ghi nhận' };
const date = (v) => v ? v.replace('T', ' ').slice(0, 19) : 'Chưa xác định';
const buildDetailWorkbook = (kind, rows, scope) => {
    const data = kind === 'students' ? rows.map(s => [String(s.user_id), s.student_hmid || '', s.username, s.name, s.room_id ?? 'Chưa chia', attendance[s.attendance], date(s.first_seen), date(s.last_seen), 'Chưa xác định', s.presence_records, s.chat_count ?? 'Chưa xác định / không có quyền', s.moderation_records ?? 'Chưa xác định / không có quyền'])
        : rows.map(e => [e.id, e.source, date(e.at), e.username || '', e.student_hmid || '', e.room || '', e.content ?? 'Không có nội dung lưu', JSON.stringify(e.metadata), e.identity]);
    const headers = kind === 'students' ? ['ID enrollment', 'HMID', 'Username', 'Họ tên', 'Room phân bổ', 'Chuyên cần', 'Ghi nhận đầu', 'Ghi nhận cuối', 'Phút học', 'Số log', 'Chat thường/trả lời', 'Hạn chế/kiểm duyệt hiện lưu']
        : ['ID bản ghi', 'Nguồn', 'Thời gian', 'Username', 'HMID', 'Phòng tại nguồn', 'Nội dung lưu', 'Metadata', 'Đối chiếu danh tính'];
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...data]);
    // Explicit string cells prevent formulas/large identifiers being interpreted as numeric expressions.
    for (const key of Object.keys(sheet).filter(k => !k.startsWith('!'))) {
        const cell = sheet[key];
        if (typeof cell.v === 'string') {
            cell.t = 's';
            delete cell.f;
        }
        cell.s = { alignment: { vertical: 'top', wrapText: true }, ...(key.match(/\d+$/)?.[0] === '1' ? { fill: { fgColor: { rgb: '103D47' } }, font: { bold: true, color: { rgb: 'FFFFFF' } } } : {}) };
    }
    sheet['!cols'] = headers.map((_, i) => ({ wch: i === 3 || i === 6 || i === 7 ? 30 : 20 }));
    sheet['!autofilter'] = { ref: sheet['!ref'] };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, kind === 'students' ? 'Học sinh' : 'Nhật ký');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Phạm vi', scope], ['Múi giờ', 'Giờ Việt Nam theo thành phần thời gian lịch, không cộng thêm UTC+7'],
        ['Chuyên cần', 'Hai status=2 liên tiếp trong cùng phiên; không ghép qua các phiên.'],
        ['Giới hạn', 'Mốc log không phải giờ vào/ra. Chưa xác định phút học, số lần kết nối lại hay đầy đủ lịch sử cấm/mở cấm.'],
        ['Roster', 'Danh sách hiện lưu và lịch sử phân bổ room, không phải snapshot enrollment tại thời điểm học.'],
    ]), 'Phạm vi và giới hạn');
    return wb;
};
exports.buildDetailWorkbook = buildDetailWorkbook;
const buildRestrictionWorkbook = (rows, scope) => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
        ['ID bản ghi', 'Mã loại chưa xác minh', 'Ghi chú lưu', 'Tạo bản ghi', 'Cập nhật bản ghi', 'Hạn lưu'],
        ...rows.map(r => [r.id, r.type, r.note ?? '', date(r.created_at), date(r.updated_at), date(r.expired_at)]),
    ]);
    sheet['!cols'] = [20, 24, 45, 23, 23, 23].map(wch => ({ wch }));
    for (const key of Object.keys(sheet).filter(k => !k.startsWith('!'))) {
        if (typeof sheet[key].v === 'string') {
            sheet[key].t = 's';
            delete sheet[key].f;
        }
        if (key.match(/\d+$/)?.[0] === '1')
            sheet[key].s = { fill: { fgColor: { rgb: '103D47' } }, font: { bold: true, color: { rgb: 'FFFFFF' } } };
    }
    XLSX.utils.book_append_sheet(wb, sheet, 'Hạn chế hiện lưu');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
        ['Phạm vi', scope], ['Giới hạn', 'Snapshot hiện lưu cho cùng chương trình + số bài qua mọi ngày. Không phải lịch sử cấm/mở cấm hoặc bằng chứng trạng thái tại buổi học. Không suy diễn actor, updated_at hoặc mã type.'],
    ]), 'Phạm vi và giới hạn');
    return wb;
};
exports.buildRestrictionWorkbook = buildRestrictionWorkbook;
