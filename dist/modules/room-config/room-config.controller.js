"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RoomConfigController = void 0;
const room_config_service_1 = __importDefault(require("./room-config.service"));
class RoomConfigController {
    roomConfigService;
    constructor(roomConfigService = room_config_service_1.default) {
        this.roomConfigService = roomConfigService;
    }
    list = async (req, res, next) => {
        try {
            const { search, code, learn_number, page, limit } = req.query;
            const result = await this.roomConfigService.list({
                search: search,
                code: code,
                learn_number: learn_number ? Number(learn_number) : undefined,
                page: page ? Number(page) : 1,
                limit: limit ? Number(limit) : 20,
            });
            return res.status(200).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            next(error);
        }
    };
    detail = async (req, res, next) => {
        try {
            const { code, learn_number } = req.params;
            const result = await this.roomConfigService.getDetail(String(code), Number(learn_number));
            return res.status(200).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            next(error);
        }
    };
    save = async (req, res, next) => {
        try {
            const currentUser = req.user;
            const updated_by = currentUser?.username || currentUser?.email || 'admin';
            const result = await this.roomConfigService.save({
                ...req.body,
                updated_by,
            });
            return res.status(200).json({
                success: true,
                message: 'Lưu cấu hình phòng thành công',
                data: result,
            });
        }
        catch (error) {
            next(error);
        }
    };
    importBulk = async (req, res, next) => {
        try {
            const currentUser = req.user;
            const updated_by = currentUser?.username || currentUser?.email || 'admin_import';
            const items = req.body.items || req.body;
            const result = await this.roomConfigService.bulkImport(items, updated_by);
            return res.status(200).json({
                success: true,
                message: `Import hoàn tất. Thành công ${result.successCount}/${result.total}`,
                data: result,
            });
        }
        catch (error) {
            next(error);
        }
    };
}
exports.RoomConfigController = RoomConfigController;
exports.default = new RoomConfigController();
