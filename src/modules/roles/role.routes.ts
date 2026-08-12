import { Router } from 'express';
import roleController from './role.controller';
import authMiddleware from '../auth/auth.middleware';

const router = Router();
const { authenticate, authorize } = authMiddleware;

router.use(authenticate);

/**
 * @swagger
 * tags:
 *   name: Roles
 *   description: Quản lý vai trò và quyền hạn
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Role:
 *       type: object
 *       properties:
 *         role_id:
 *           type: integer
 *         role_name:
 *           type: string
 *         description:
 *           type: string
 */

// Route to get all roles
/**
 * @swagger
 * /api/roles:
 *   get:
 *     summary: Lấy danh sách tất cả vai trò
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Danh sách vai trò
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Role'
 */
router.get('/', authorize(['roles.view']), roleController.getAllRoles);

// Route to get module structure for UI
router.get('/modules-structure', authorize(['roles.view']), roleController.getModulesStructure);

// Route to get permissions structure for UI
router.get('/permissions-structure', authorize(['roles.view']), roleController.getPermissionsStructure);

// Program-level scope APIs. Keep these routes before the generic /:id route.
router.get('/program-resources', authorize(['roles.view']), roleController.getProgramResources);
router.get('/:id/program-scope', authorize(['roles.view']), roleController.getProgramScopes);
router.put('/:id/program-scope', authorize(['roles.update']), roleController.updateProgramScopes);

// Field-level policy APIs
router.get('/:id/field-policy', authorize(['roles.view']), roleController.getRoleFieldPolicy);
router.put('/:id/field-policy', authorize(['roles.update']), roleController.updateRoleFieldPolicy);

// Route to get a role by ID
/**
 * @swagger
 * /api/roles/{id}:
 *   get:
 *     summary: Lấy thông tin vai trò theo ID
 *     tags: [Roles]
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
 *         description: Chi tiết vai trò
 */
router.get('/:id', authorize(['roles.view']), roleController.getRoleById);

// Route to create a new role
/**
 * @swagger
 * /api/roles:
 *   post:
 *     summary: Tạo vai trò mới
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - role_name
 *             properties:
 *               role_name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tạo thành công
 */
router.post('/', authorize(['roles.create']), roleController.createRole);

// Route to update a role by ID
/**
 * @swagger
 * /api/roles/{id}:
 *   put:
 *     summary: Cập nhật thông tin vai trò
 *     tags: [Roles]
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
 *             $ref: '#/components/schemas/Role'
 *     responses:
 *       200:
 *         description: Cập nhật thành công
 */
router.put('/:id', authorize(['roles.update']), roleController.updateRole);

// Route to delete a role by ID
/**
 * @swagger
 * /api/roles/{id}:
 *   delete:
 *     summary: Xóa vai trò
 *     tags: [Roles]
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
 *         description: Xóa thành công
 */
router.delete('/:id', authorize(['roles.delete']), roleController.deleteRole);

export default router;
