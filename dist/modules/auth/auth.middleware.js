"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("@prisma/client");
const logger_1 = require("../../utils/logger");
const constants_1 = require("./constants");
const field_permission_service_1 = __importDefault(require("../roles/field-permission.service"));
const authorization_service_1 = require("../../services/authorization.service");
const prisma = new client_1.PrismaClient();
// Middleware xác thực JWT
const authenticate = async (req, res, next) => {
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
        const decoded = jsonwebtoken_1.default.verify(token, accessTokenSecret);
        if (decoded.type !== constants_1.TOKEN_TYPES.ACCESS || !decoded.sessionId) {
            res.status(401).json({ success: false, message: 'Invalid token type' });
            return;
        }
        const sessions = await prisma.$queryRaw `
      SELECT id, user_id, expires_at, revoked_at
      FROM auth_sessions
      WHERE id = ${String(decoded.sessionId)}
      LIMIT 1
    `;
        const session = sessions[0];
        if (!session
            || Number(session.user_id) !== Number(decoded.userId)
            || session.revoked_at
            || session.expires_at <= new Date()) {
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
        const { roles, permissionCodes, programScope } = await (0, authorization_service_1.loadUserAccess)(user.id);
        // Gắn user vào request
        req.user = {
            userId: user.id,
            sessionId: session.id,
            username: user.username,
            roleIds: roles.map((r) => r.id.toString()),
            roles: roles.map((r) => r.code),
            permissions: permissionCodes,
            programScope,
        };
        next();
    }
    catch (error) {
        logger_1.logger.error('Authentication error:', error);
        res.status(401).json({ success: false, message: 'Authentication failed' });
    }
};
// Middleware phân quyền theo Role hoặc Permission
// Dùng checkPermissions(['MANAGE_LIVESTREAM', 'ADMIN']) => Cần ít nhất 1 quyền
const authorize = (requiredPermissions = []) => {
    return async (req, res, next) => {
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
        }
        catch (error) {
            res.status(500).json({ success: false, message: 'Authorization error' });
        }
    };
};
const authorizeFields = (moduleCode, extractFields) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                res.status(401).json({ success: false, message: 'Not authenticated' });
                return;
            }
            await field_permission_service_1.default.assertEditableFields(req.user.roleIds || [], moduleCode, extractFields(req));
            next();
        }
        catch (error) {
            res.status(error.statusCode || 403).json({
                success: false,
                message: error.message || 'Field permission denied',
            });
        }
    };
};
const authorizeProgram = (permissionCode, extractProgramCode) => (req, res, next) => {
    try {
        (0, authorization_service_1.assertProgramAccess)(req.user, permissionCode, extractProgramCode(req));
        next();
    }
    catch (error) {
        res.status(error.statusCode || 403).json({
            success: false,
            message: error.message || 'Program permission denied',
        });
    }
};
const authorizePrograms = (permissionCode, resolveProgramCodes) => async (req, res, next) => {
    try {
        const codes = Array.from(new Set((await resolveProgramCodes(req)).map((code) => String(code || '').trim()).filter(Boolean)));
        if (!codes.length) {
            res.status(400).json({ success: false, message: 'Không xác định được Chương trình' });
            return;
        }
        codes.forEach((code) => (0, authorization_service_1.assertProgramAccess)(req.user, permissionCode, code));
        next();
    }
    catch (error) {
        res.status(error.statusCode || 403).json({
            success: false,
            message: error.message || 'Program permission denied',
        });
    }
};
const authorizeProgramForAny = (permissionCodes, extractProgramCode) => (req, res, next) => {
    const code = String(extractProgramCode(req) || '').trim();
    const allowed = permissionCodes.some((permissionCode) => {
        try {
            (0, authorization_service_1.assertProgramAccess)(req.user, permissionCode, code);
            return true;
        }
        catch {
            return false;
        }
    });
    if (allowed)
        return next();
    res.status(403).json({ success: false, message: 'Không có quyền thao tác trên Chương trình này' });
};
const authorizeProgramsForAny = (permissionCodes, resolveProgramCodes) => async (req, res, next) => {
    try {
        const codes = Array.from(new Set((await resolveProgramCodes(req)).map((code) => String(code || '').trim()).filter(Boolean)));
        const allowed = codes.length > 0 && codes.every((code) => (permissionCodes.some((permissionCode) => {
            try {
                (0, authorization_service_1.assertProgramAccess)(req.user, permissionCode, code);
                return true;
            }
            catch {
                return false;
            }
        })));
        if (!allowed)
            throw new Error('Không có quyền thao tác trên Chương trình này');
        next();
    }
    catch (error) {
        res.status(403).json({ success: false, message: error.message || 'Program permission denied' });
    }
};
exports.default = {
    authenticate,
    authorize,
    authorizeFields,
    authorizeProgram,
    authorizePrograms,
    authorizeProgramForAny,
    authorizeProgramsForAny,
};
