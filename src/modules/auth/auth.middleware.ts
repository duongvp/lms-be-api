import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';
import { TOKEN_TYPES } from './constants';
import FieldPermissionService from '../roles/field-permission.service';

const prisma = new PrismaClient();

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

    const user = await prisma.users.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

    // Lấy roles và permissions
    const userRoles = await prisma.userRoles.findMany({
      where: {
        userId: user.id,
        role: { isActive: true },
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: true }
            }
          }
        }
      }
    });

    const roles = userRoles.map(ur => ur.role);
    const permissionsMap = new Map();
    roles.forEach(r => {
      r.rolePermissions.forEach(rp => {
        if (rp.permission) {
          permissionsMap.set(rp.permission.code, rp.permission);
        }
      });
    });

    // Gắn user vào request
    req.user = {
      userId: user.id,
      sessionId: session.id,
      username: user.username,
      roleIds: roles.map(r => r.id.toString()),
      roles: roles.map(r => r.code),
      permissions: Array.from(permissionsMap.keys())
    };

    next();
  } catch (error: any) {
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
        const hasPermission = requiredPermissions.some(p => userPerms.includes(p));

        // Hoặc kiểm tra role nếu mảng required có chứa role cụ thể (ví dụ: 'admin')
        const userRoles = req.user.roles || [];
        const hasRole = requiredPermissions.some(r => userRoles.includes(r));

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

export default {
  authenticate,
  authorize,
  authorizeFields,
};
