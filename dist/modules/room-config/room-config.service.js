"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomConfigService = void 0;
const room_config_repository_1 = __importDefault(require("./room-config.repository"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
class RoomConfigService {
    repo;
    constructor(repo = room_config_repository_1.default) {
        this.repo = repo;
    }
    async list(filter) {
        return this.repo.findMany(filter);
    }
    async getDetail(code, learn_number) {
        if (!code || isNaN(Number(learn_number))) {
            throw new ApiError_1.default('Mã môn học (code) và Số buổi học (learn_number) là bắt buộc', 400);
        }
        const item = await this.repo.findByKey(code, Number(learn_number));
        if (!item) {
            throw new ApiError_1.default('Không tìm thấy cấu hình phòng học tương ứng', 404);
        }
        return item;
    }
    async save(input) {
        if (!input.code || input.learn_number === undefined || input.learn_number === null || isNaN(Number(input.learn_number))) {
            throw new ApiError_1.default('Mã môn (code/subject) và Số buổi học (learn_number) là bắt buộc', 400);
        }
        // Ensure config is valid object
        let parsedConfig = input.config;
        if (typeof parsedConfig === 'string') {
            try {
                parsedConfig = JSON.parse(parsedConfig);
            }
            catch (err) {
                throw new ApiError_1.default('Cấu hình JSON không hợp lệ', 400);
            }
        }
        return this.repo.upsertRoomConfig({
            ...input,
            code: input.code.trim(),
            learn_number: Number(input.learn_number),
            config: parsedConfig || {},
        });
    }
    async bulkImport(items, updatedBy) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new ApiError_1.default('Danh sách dữ liệu import không được rỗng', 400);
        }
        const results = [];
        const errors = [];
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            try {
                if (!item.code || item.learn_number === undefined || item.learn_number === null) {
                    throw new Error(`Dòng ${index + 1}: Thiếu subject/code hoặc learn_number`);
                }
                const saved = await this.save({
                    ...item,
                    updated_by: updatedBy || item.updated_by || 'import',
                });
                results.push(saved);
            }
            catch (err) {
                errors.push({
                    row: index + 1,
                    code: item.code,
                    learn_number: item.learn_number,
                    message: err.message || 'Lỗi xử lý',
                });
            }
        }
        return {
            total: items.length,
            successCount: results.length,
            errorCount: errors.length,
            errors,
            items: results,
        };
    }
}
exports.RoomConfigService = RoomConfigService;
exports.default = new RoomConfigService();
