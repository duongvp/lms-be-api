export const RBAC_MENU_MODULES = [
    { code: 'lessons', label: 'Quản lý nội dung' },
    { code: 'calendar', label: 'Quản lý lịch học' },
    { code: 'teacher_profile', label: 'Giáo viên & Trợ giảng' },
    { code: 'users', label: 'Quản trị viên' },
    { code: 'roles', label: 'Vai trò thành viên' },
] as const;

export const RBAC_MENU_MODULE_CODES = RBAC_MENU_MODULES.map(({ code }) => code);

// Vai trò thành viên là màn cấu hình quyền, không phải dữ liệu nghiệp vụ
// cần kiểm soát theo từng field.
export const RBAC_FIELD_MODULE_CODES = RBAC_MENU_MODULE_CODES.filter(
    (code) => code !== 'roles'
);

export const RBAC_MENU_LABELS = Object.fromEntries(
    RBAC_MENU_MODULES.map(({ code, label }) => [code, label])
) as Record<string, string>;
