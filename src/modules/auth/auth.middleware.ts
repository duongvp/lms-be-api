import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../../lib/prisma';
import { logger } from '../../utils/logger';
import { TOKEN_TYPES } from './constants';
import { Prisma } from '@prisma/client';
import FieldPermissionService from '../roles/field-permission.service';
import { assertProgramAccess, loadUserAccess } from '../../services/authorization.service';

// Extending Express Request to include our custom user object
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

// Middleware xác thực JWT
const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ success: false, message: 'Authentication token missing' });
      return;
    }

    const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;
    if (!accessTokenSecret?.trim()) {
      res.status(503).json({ success: false, message: 'Authentication is not configured' });
      return;
    }

    const decoded = jwt.verify(
      token,
      accessTokenSecret
    ) as any;

    if (decoded.type !== TOKEN_TYPES.ACCESS || !decoded.sessionId) {
      res.status(401).json({ success: false, message: 'Invalid token type' });
      return;
    }

    const sessions = await prisma.$queryRaw<Array<{
      id: string;
      user_id: bigint;
      expires_at: Date;
      revoked_at: Date | null;
    }>>`
      SELECT id, user_id, expires_at, revoked_at
      FROM auth_sessions
      WHERE id = ${String(decoded.sessionId)}
      LIMIT 1
    `;
    const session = sessions[0];
    if (
      !session
      || Number(session.user_id) !== Number(decoded.userId)
      || session.revoked_at
      || session.expires_at <= new Date()
    ) {
      res.status(401).json({ success: false, message: 'Session is invalid or revoked' });
      return;
    }

    // loadUserAccess cache cả user và RBAC trong thời gian ngắn. Sau lần đầu,
    // mỗi request chỉ cần truy vấn session thay vì đọc lại user/role/scope.
    const { user, roles, permissionCodes, programScope } = await loadUserAccess(
      Number(decoded.userId)
    );

    // Gắn user vào request
    req.user = {
      userId: user.id,
      sessionId: session.id,
      username: user.username,
      roleIds: roles.map((r: any) => r.id.toString()),
      roles: roles.map((r: any) => r.code),
      permissions: permissionCodes,
      programScope,
    };

    next();
  } catch (error: any) {
    const isPoolTimeout = error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === 'P2024';
    if (isPoolTimeout) {
      logger.error('Database connection pool timeout during authentication:', error);
      res.status(503).json({
        success: false,
        message: 'Hệ thống đang bận, vui lòng thử lại sau giây lát',
      });
      return;
    }
    logger.error('Authentication error:', error);
    res.status(401).json({ success: false, message: 'Authentication failed' });
  }
};

// Middleware phân quyền theo Role hoặc Permission
// Dùng checkPermissions(['MANAGE_LIVESTREAM', 'ADMIN']) => Cần ít nhất 1 quyền
const authorize = (requiredPermissions: string[] = []) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Not authenticated' });
        return;
      }

      if (requiredPermissions.length > 0) {
        const userPerms = req.user.permissions || [];
        const hasPermission = userPerms.includes('*')
          || requiredPermissions.some(p => userPerms.includes(p));

        // Hoặc kiểm tra role nếu mảng required có chứa role cụ thể (ví dụ: 'admin')
        const userRoles = req.user.roles || [];
        const hasRole = userRoles.includes('admin')
          || requiredPermissions.some(r => userRoles.includes(r));

        if (!hasPermission && !hasRole) {
          res.status(403).json({ success: false, message: 'Insufficient permissions' });
          return;
        }
      }

      next();
    } catch (error: any) {
      res.status(500).json({ success: false, message: 'Authorization error' });
    }
  };
};

const authorizeFields = (
  moduleCode: string,
  extractFields: (req: Request) => string[]
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, message: 'Not authenticated' });
        return;
      }
      await FieldPermissionService.assertEditableFields(
        req.user.roleIds || [],
        moduleCode,
        extractFields(req)
      );
      next();
    } catch (error: any) {
      res.status(error.statusCode || 403).json({
        success: false,
        message: error.message || 'Field permission denied',
      });
    }
  };
};

const authorizeProgram = (
  permissionCode: string,
  extractProgramCode: (req: Request) => string
) => (req: Request, res: Response, next: NextFunction): void => {
  try {
    assertProgramAccess(req.user, permissionCode, extractProgramCode(req));
    next();
  } catch (error: any) {
    res.status(error.statusCode || 403).json({
      success: false,
      message: error.message || 'Program permission denied',
    });
  }
};

const authorizePrograms = (
  permissionCode: string,
  resolveProgramCodes: (req: Request) => string[] | Promise<string[]>
) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const codes = Array.from(new Set(
      (await resolveProgramCodes(req)).map((code) => String(code || '').trim()).filter(Boolean)
    ));
    if (!codes.length) {
      res.status(400).json({ success: false, message: 'Không xác định được Chương trình' });
      return;
    }
    codes.forEach((code) => assertProgramAccess(req.user, permissionCode, code));
    next();
  } catch (error: any) {
    res.status(error.statusCode || 403).json({
      success: false,
      message: error.message || 'Program permission denied',
    });
  }
};

const authorizeProgramForAny = (
  permissionCodes: string[],
  extractProgramCode: (req: Request) => string
) => (req: Request, res: Response, next: NextFunction): void => {
  const code = String(extractProgramCode(req) || '').trim();
  const allowed = permissionCodes.some((permissionCode) => {
    try {
      assertProgramAccess(req.user, permissionCode, code);
      return true;
    } catch {
      return false;
    }
  });
  if (allowed) return next();
  res.status(403).json({ success: false, message: 'Không có quyền thao tác trên Chương trình này' });
};

const authorizeProgramsForAny = (
  permissionCodes: string[],
  resolveProgramCodes: (req: Request) => string[] | Promise<string[]>
) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const codes = Array.from(new Set(
      (await resolveProgramCodes(req)).map((code) => String(code || '').trim()).filter(Boolean)
    ));
    const allowed = codes.length > 0 && codes.every((code) => (
      permissionCodes.some((permissionCode) => {
        try {
          assertProgramAccess(req.user, permissionCode, code);
          return true;
        } catch {
          return false;
        }
      })
    ));
    if (!allowed) throw new Error('Không có quyền thao tác trên Chương trình này');
    next();
  } catch (error: any) {
    res.status(403).json({ success: false, message: error.message || 'Program permission denied' });
  }
};

export default {
  authenticate,
  authorize,
  authorizeFields,
  authorizeProgram,
  authorizePrograms,
  authorizeProgramForAny,
  authorizeProgramsForAny,
};
