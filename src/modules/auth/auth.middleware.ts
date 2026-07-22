import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { logger } from '../../utils/logger';
import { TOKEN_TYPES } from './constants';

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

    const decoded = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET as string
    ) as any;

    if (decoded.type !== TOKEN_TYPES.ACCESS) {
      res.status(401).json({ success: false, message: 'Invalid token type' });
      return;
    }

    // Kiểm tra user tồn tại
    const user = await prisma.users.findUnique({
      where: { id: decoded.userId }
    });

    if (!user) {
      res.status(401).json({ success: false, message: 'User not found' });
      return;
    }

    // Lấy roles và permissions
    const userRoles = await prisma.userRoles.findMany({
      where: { userId: user.id },
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
      username: user.username,
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

export default {
  authenticate,
  authorize
};