import { Router } from 'express';
import userController from './user.controller';
import { authMiddleware } from '../auth'; // giả định đường dẫn đúng

const router = Router();
const { authenticate, authorize, authorizeFields } = authMiddleware;
const authorizeAdmin = (req: any, res: any, next: any) => {
    if (!req.user?.roles?.includes('admin')) {
        return res.status(403).json({
            success: false,
            message: 'Chỉ tài khoản admin được phép tạo tài khoản quản trị',
        });
    }
    next();
};
const authorizeRoleAssignment = (req: any, res: any, next: any) => {
    if (
        req.body?.roleIds !== undefined
        && !req.user?.roles?.includes('admin')
    ) {
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
router.get('/', authorize(['users.view']), userController.getAllUsers);
router.post('/', authorize(['users.create']), authorizeAdmin, userController.createUser);

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
router.get('/:id', authorize(['users.view']), userController.getUserById);

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
router.put(
    '/:id',
    authorize(['users.update']),
    authorizeRoleAssignment,
    authorizeFields('users', (req) =>
        Object.keys(req.body || {}).filter((field) => field !== 'roleIds')
    ),
    userController.updateUser
);

// Các route delete, toggle có thể thêm sau khi bổ sung schema

export default router;
