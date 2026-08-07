import { Request, Response, NextFunction } from 'express';
import service, { RoomConfigService } from './room-config.service';

export class RoomConfigController {
  constructor(private roomConfigService: RoomConfigService = service) {}

  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { search, code, learn_number, page, limit } = req.query;
      const result = await this.roomConfigService.list({
        search: search as string,
        code: code as string,
        learn_number: learn_number ? Number(learn_number) : undefined,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
      });

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  detail = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code, learn_number } = req.params;
      const result = await this.roomConfigService.getDetail(
        String(code),
        Number(learn_number)
      );

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  save = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = (req as any).user;
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
    } catch (error) {
      next(error);
    }
  };

  importBulk = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const currentUser = (req as any).user;
      const updated_by = currentUser?.username || currentUser?.email || 'admin_import';
      const items = req.body.items || req.body;

      const result = await this.roomConfigService.bulkImport(items, updated_by);

      return res.status(200).json({
        success: true,
        message: `Import hoàn tất. Thành công ${result.successCount}/${result.total}`,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

export default new RoomConfigController();
