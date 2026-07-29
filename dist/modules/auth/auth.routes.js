"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = __importDefault(require("./auth.controller"));
const auth_middleware_1 = __importDefault(require("./auth.middleware"));
const router = (0, express_1.Router)();
const { authenticate } = auth_middleware_1.default;
const validateLogin = (req, res, next) => {
    const { username, password, rememberMe } = req.body || {};
    if (typeof username !== 'string'
        || !username.trim()
        || username.length > 100
        || typeof password !== 'string'
        || !password
        || password.length > 255
        || (rememberMe !== undefined && typeof rememberMe !== 'boolean')) {
        return res.status(400).json({
            success: false,
            message: 'username/password/rememberMe không hợp lệ',
        });
    }
    next();
};
/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication management
 */
// Public routes
/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               fullName:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 */
router.post('/register', auth_controller_1.default.register);
/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login to the system
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       401:
 *         description: Invalid credentials
 */
router.post('/login', validateLogin, auth_controller_1.default.login);
router.post('/refresh-token', auth_controller_1.default.refreshToken);
// Quên mật khẩu routes (public)
router.post('/forgot-password', auth_controller_1.default.requestPasswordReset);
router.post('/verify-reset-otp', auth_controller_1.default.verifyOTP);
router.post('/reset-password', auth_controller_1.default.resetPassword);
// Protected routes
router.post('/logout', authenticate, auth_controller_1.default.logout);
/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get current user information
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get('/me', authenticate, auth_controller_1.default.getMe);
router.get('/profile', authenticate, auth_controller_1.default.getProfile);
exports.default = router;
