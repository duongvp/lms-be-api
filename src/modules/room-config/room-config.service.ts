import repository, { RoomConfigRepository } from './room-config.repository';
import { RoomConfigFilter, SaveRoomConfigInput } from './room-config.types';
import ApiError from '../../utils/ApiError';

export class RoomConfigService {
  constructor(private repo: RoomConfigRepository = repository) {}

  async list(filter: RoomConfigFilter, allowedPrograms: string[] | null = null) {
    return this.repo.findMany(filter, allowedPrograms);
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

  async bulkImport(programCode: string, items: SaveRoomConfigInput[], updatedBy?: string) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new ApiError('Danh sách dữ liệu import không được rỗng', 400);
    }
    const normalizedProgramCode = String(programCode || '').trim();
    if (!normalizedProgramCode) {
      throw new ApiError('Vui lòng chọn Chương trình trước khi import', 400);
    }
    if (items.length > 1000) {
      throw new ApiError('Mỗi lần chỉ import tối đa 1.000 dòng', 400);
    }

    const keys = new Set<string>();
    const normalizedItems = items.map((item, index) => {
      const code = String(item?.code || '').trim();
      const learnNumber = Number(item?.learn_number);
      if (!code || !Number.isInteger(learnNumber) || learnNumber <= 0) {
        throw new ApiError(`Dòng ${index + 1}: Mã chương trình và số bài phải hợp lệ`, 400);
      }
      if (code !== normalizedProgramCode) {
        throw new ApiError(`Dòng ${index + 1}: Không thuộc Chương trình ${normalizedProgramCode}`, 400);
      }
      const key = `${code}:${learnNumber}`;
      if (keys.has(key)) {
        throw new ApiError(`Dòng ${index + 1}: Bị trùng bài ${learnNumber} trong file`, 400);
      }
      keys.add(key);
      let config = item.config;
      if (typeof config === 'string') {
        try {
          config = JSON.parse(config);
        } catch {
          throw new ApiError(`Dòng ${index + 1}: Cấu hình JSON không hợp lệ`, 400);
        }
      }
      if (config !== undefined && (config === null || Array.isArray(config) || typeof config !== 'object')) {
        throw new ApiError(`Dòng ${index + 1}: Cấu hình phải là JSON object`, 400);
      }
      return {
        code,
        learn_number: learnNumber,
        config: config || {},
        updated_by: updatedBy || item.updated_by || 'import',
      };
    });

    const results = await this.repo.bulkUpsertRoomConfigs(normalizedItems);

    return {
      total: items.length,
      successCount: results.length,
      errorCount: 0,
      errors: [],
      items: results,
    };
  }
}

export default new RoomConfigService();
