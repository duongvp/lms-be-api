import repository, { RoomConfigRepository } from './room-config.repository';
import { RoomConfigFilter, SaveRoomConfigInput } from './room-config.types';
import ApiError from '../../utils/ApiError';

export class RoomConfigService {
  constructor(private repo: RoomConfigRepository = repository) {}

  async list(filter: RoomConfigFilter) {
    return this.repo.findMany(filter);
  }

  async getDetail(code: string, learn_number: number) {
    if (!code || isNaN(Number(learn_number))) {
      throw new ApiError('Mã môn học (code) và Số buổi học (learn_number) là bắt buộc', 400);
    }
    const item = await this.repo.findByKey(code, Number(learn_number));
    if (!item) {
      throw new ApiError('Không tìm thấy cấu hình phòng học tương ứng', 404);
    }
    return item;
  }

  async save(input: SaveRoomConfigInput) {
    if (!input.code || input.learn_number === undefined || input.learn_number === null || isNaN(Number(input.learn_number))) {
      throw new ApiError('Mã môn (code/subject) và Số buổi học (learn_number) là bắt buộc', 400);
    }

    // Ensure config is valid object
    let parsedConfig = input.config;
    if (typeof parsedConfig === 'string') {
      try {
        parsedConfig = JSON.parse(parsedConfig);
      } catch (err) {
        throw new ApiError('Cấu hình JSON không hợp lệ', 400);
      }
    }

    return this.repo.upsertRoomConfig({
      ...input,
      code: input.code.trim(),
      learn_number: Number(input.learn_number),
      config: parsedConfig || {},
    });
  }

  async bulkImport(items: SaveRoomConfigInput[], updatedBy?: string) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError('Danh sách dữ liệu import không được rỗng', 400);
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
      } catch (err: any) {
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

export default new RoomConfigService();
