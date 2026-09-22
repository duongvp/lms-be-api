"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCalendarExportSystem = void 0;
const resolveCalendarExportSystem = (calendar, linkedProgram, candidates) => {
    if (linkedProgram)
        return linkedProgram.system_type;
    const systems = new Set(candidates.map((row) => row.system_type));
    if (systems.size > 1)
        throw new Error(`Chương trình ${calendar.code} có đề cương thuộc nhiều hệ. Cần xác định lại trước khi xuất.`);
    return candidates[0]?.system_type || calendar.system_type || 'topclass';
};
exports.resolveCalendarExportSystem = resolveCalendarExportSystem;
