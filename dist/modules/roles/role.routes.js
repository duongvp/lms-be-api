"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const role_controller_1 = __importDefault(require("./role.controller"));
const auth_middleware_1 = __importDefault(require("../auth/auth.middleware"));
const router = (0, express_1.Router)();
const { authenticate, authorize } = auth_middleware_1.default;
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
router.get('/', authorize(['roles.view']), role_controller_1.default.getAllRoles);
// Route to get module structure for UI
router.get('/modules-structure', authorize(['roles.view']), role_controller_1.default.getModulesStructure);
// Route to get permissions structure for UI
router.get('/permissions-structure', authorize(['roles.view']), role_controller_1.default.getPermissionsStructure);
// Field-level policy APIs
router.get('/:id/field-policy', authorize(['roles.view']), role_controller_1.default.getRoleFieldPolicy);
router.put('/:id/field-policy', authorize(['roles.update']), role_controller_1.default.updateRoleFieldPolicy);
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
router.get('/:id', authorize(['roles.view']), role_controller_1.default.getRoleById);
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
router.post('/', authorize(['roles.create']), role_controller_1.default.createRole);
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
router.put('/:id', authorize(['roles.update']), role_controller_1.default.updateRole);
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
router.delete('/:id', authorize(['roles.delete']), role_controller_1.default.deleteRole);
exports.default = router;
