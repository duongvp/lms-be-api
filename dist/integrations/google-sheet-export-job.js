"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduledSheetExportJob = exports.startSheetExportJob = exports.getSheetExportJob = void 0;
const node_crypto_1 = require("node:crypto");
const ApiError_1 = __importDefault(require("../utils/ApiError"));
const jobs = new Map();
const retentionMs = 60 * 60 * 1000;
const startJob = (owner, target, task, onFinished) => {
    const targets = Array.isArray(target) ? target : [target];
    for (const [id, entry] of jobs) {
        if (entry.job.status !== 'running' && Date.now() - entry.updatedAt > retentionMs)
            jobs.delete(id);
        else if (entry.job.status === 'running' && entry.targets.some((item) => targets.includes(item)))
            throw new ApiError_1.default('Sheet này đang được xuất dữ liệu. Vui lòng chờ lượt xuất hoàn tất.', 409);
    }
    if ([...jobs.values()].filter((entry) => entry.job.status === 'running').length >= 5)
        throw new ApiError_1.default('Hệ thống đang xử lý các lượt xuất khác. Vui lòng thử lại sau.', 409);
    const job = { jobId: (0, node_crypto_1.randomUUID)(), status: 'running', progress: 0, message: 'Đang chuẩn bị dữ liệu chương trình…' };
    const entry = { owner, targets, updatedAt: Date.now(), job };
    jobs.set(job.jobId, entry);
    void Promise.resolve().then(() => task((progress, message) => {
        job.progress = Math.max(job.progress, Math.min(99, progress));
        job.message = message;
        entry.updatedAt = Date.now();
    })).then((result) => {
        job.result = result;
        job.status = 'completed';
        job.progress = 100;
        job.message = 'Xuất Google Sheets thành công.';
    }).catch((error) => {
        job.status = 'failed';
        job.error = error instanceof Error ? error.message : 'Không thể xuất Google Sheets.';
        job.message = job.error;
    }).finally(() => { entry.updatedAt = Date.now(); onFinished?.({ ...job }); });
    return { ...job };
};
const getSheetExportJob = (jobId, owner) => {
    const entry = jobs.get(jobId);
    if (!entry || entry.owner !== owner)
        throw new ApiError_1.default('Không tìm thấy lượt xuất Google Sheets. Nếu backend vừa khởi động lại, hãy kiểm tra sheet trước khi xuất lại.', 404);
    return { ...entry.job };
};
exports.getSheetExportJob = getSheetExportJob;
const startSheetExportJob = (owner, target, task) => {
    if (!Number.isInteger(owner) || owner <= 0)
        throw new ApiError_1.default('Phiên đăng nhập không hợp lệ.', 401);
    return startJob(owner, target, task);
};
exports.startSheetExportJob = startSheetExportJob;
const startScheduledSheetExportJob = (target, task, onFinished) => startJob(null, target, task, onFinished);
exports.startScheduledSheetExportJob = startScheduledSheetExportJob;
