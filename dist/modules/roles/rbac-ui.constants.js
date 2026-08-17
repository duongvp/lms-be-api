"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RBAC_MENU_LABELS = exports.RBAC_FIELD_MODULE_CODES = exports.RBAC_MENU_MODULE_CODES = exports.RBAC_MENU_MODULES = void 0;
exports.RBAC_MENU_MODULES = [
    { code: 'lessons', label: 'Quản lý đề cương' },
    { code: 'quiz', label: 'Quản lý câu hỏi' },
    { code: 'calendar', label: 'Quản lý lịch học' },
    { code: 'room_config', label: 'Cấu hình phòng học' },
    { code: 'teacher_profile', label: 'Giáo viên & Trợ giảng' },
    { code: 'users', label: 'Quản trị viên' },
    { code: 'roles', label: 'Vai trò thành viên' },
];
exports.RBAC_MENU_MODULE_CODES = exports.RBAC_MENU_MODULES.map(({ code }) => code);
// Vai trò thành viên là màn cấu hình quyền, không phải dữ liệu nghiệp vụ
// cần kiểm soát theo từng field.
exports.RBAC_FIELD_MODULE_CODES = exports.RBAC_MENU_MODULE_CODES.filter((code) => code !== 'roles');
exports.RBAC_MENU_LABELS = Object.fromEntries(exports.RBAC_MENU_MODULES.map(({ code, label }) => [code, label]));
