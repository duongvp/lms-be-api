"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = __importDefault(require("./user.controller"));
const auth_1 = require("../auth"); // giả định đường dẫn đúng
const router = (0, express_1.Router)();
const { authenticate, authorize, authorizeFields } = auth_1.authMiddleware;
const authorizeRoleAssignment = (req, res, next) => {
    if (req.body?.roleIds !== undefined
        && !req.user?.roles?.includes('admin')) {
        return res.status(403).json({
            success: false,
            message: 'Only admin can assign roles',
        });
    }
    next();
};
router.use(authenticate);
/**
 * @swagger
 * tags:
 *   name: Users
 *   description: Quản lý người dùng hệ thống
 */
/**
 * @swagger
 * /api/users:
 *   get:
 *     summary: Lấy danh sách tất cả người dùng (kèm roles)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Thành công
 */
router.get('/', authorize(['users.view']), user_controller_1.default.getAllUsers);
/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Lấy thông tin người dùng theo ID
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Chi tiết người dùng
 */
router.get('/:id', authorize(['users.view']), user_controller_1.default.getUserById);
/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Cập nhật thông tin người dùng (có thể gán roles)
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               username:
 *                 type: string
 *               roleIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.put('/:id', authorize(['users.update']), authorizeRoleAssignment, authorizeFields('users', (req) => Object.keys(req.body || {}).filter((field) => field !== 'roleIds')), user_controller_1.default.updateUser);
// Các route delete, toggle có thể thêm sau khi bổ sung schema
exports.default = router;
