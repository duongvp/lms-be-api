"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.APPROVAL_MODULES = void 0;
// Register a module only after its backend implements an approval workflow.
// Permission codes remain independent from policy values.
exports.APPROVAL_MODULES = [{
        key: 'calendar', label: 'Quản lý lịch học', managePermission: 'calendar.workflow.manage', defaultPolicy: 'REQUIRE',
        actions: [
            { key: 'create', label: 'Tạo lịch' }, { key: 'update', label: 'Sửa lịch' }, { key: 'delete', label: 'Xóa lịch' },
            { key: 'cancel', label: 'Nghỉ học' }, { key: 'reschedule', label: 'Dời lịch / học bù' },
            { key: 'swap', label: 'Hoán đổi lịch' }, { key: 'restore', label: 'Khôi phục lịch' },
            { key: 'mapping', label: 'Liên kết dữ liệu Học Mãi' }, { key: 'import', label: 'Nhập file lịch' },
        ],
    }];
