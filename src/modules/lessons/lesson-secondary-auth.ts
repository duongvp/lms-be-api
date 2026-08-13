import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import ApiError from '../../utils/ApiError';

const TOKEN_SCOPE = 'lessons.secondary';

const configuredHash = () => String(
  process.env.LESSONS_SECONDARY_PASSWORD_HASH || ''
).trim().toLowerCase();

const tokenSecret = () => String(
  process.env.LESSONS_REAUTH_TOKEN_SECRET || ''
).trim();

const safeEqualHex = (left: string, right: string) => {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
};

export const issueLessonSecondaryToken = (req: Request, password: unknown) => {
  const expectedHash = configuredHash();
  const secret = tokenSecret();
  if (!expectedHash || !secret) {
    throw new ApiError('Xác thực cấp 2 cho đề cương chưa được cấu hình', 503);
  }
  if (typeof password !== 'string' || !password || password.length > 255) {
    throw new ApiError('Mật khẩu cấp 2 không hợp lệ', 400);
  }

  const actualHash = crypto.createHash('sha256').update(password, 'utf8').digest('hex');
  if (!safeEqualHex(actualHash, expectedHash)) {
    throw new ApiError('Mật khẩu cấp 2 không đúng', 401);
  }

  const configuredMinutes = Number(process.env.LESSONS_REAUTH_TTL_MINUTES);
  const ttlMinutes = Number.isInteger(configuredMinutes)
    ? Math.min(Math.max(configuredMinutes, 1), 480)
    : 60;
  const token = jwt.sign({
    type: TOKEN_SCOPE,
    userId: Number(req.user?.userId),
    sessionId: String(req.user?.sessionId || ''),
  }, secret, { expiresIn: `${ttlMinutes}m` });

  return { token, expiresInSeconds: ttlMinutes * 60 };
};

export const requireLessonSecondaryAuth = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const token = String(req.headers['x-lessons-reauth'] || '').trim();
    const secret = tokenSecret();
    if (!token || !secret) {
      return res.status(428).json({
        success: false,
        code: 'LESSONS_REAUTH_REQUIRED',
        message: 'Vui lòng xác thực mật khẩu cấp 2 để truy cập đề cương',
      });
    }

    const decoded = jwt.verify(token, secret) as any;
    if (
      decoded?.type !== TOKEN_SCOPE
      || Number(decoded?.userId) !== Number(req.user?.userId)
      || String(decoded?.sessionId || '') !== String(req.user?.sessionId || '')
    ) {
      throw new Error('Invalid secondary token');
    }
    return next();
  } catch {
    return res.status(428).json({
      success: false,
      code: 'LESSONS_REAUTH_REQUIRED',
      message: 'Phiên xác thực cấp 2 đã hết hạn hoặc không hợp lệ',
    });
  }
};
