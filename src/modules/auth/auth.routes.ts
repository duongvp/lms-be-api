import { Router } from 'express';
import controllers from './auth.controller';
import middleware from './auth.middleware';

const router = Router();

const { authenticate } = middleware;

const validateLogin = (req: any, res: any, next: any) => {
    const { username, password, rememberMe } = req.body || {};
    if (
        typeof username !== 'string'
        || !username.trim()
        || username.length > 100
        || typeof password !== 'string'
        || !password
        || password.length > 255
        || (rememberMe !== undefined && typeof rememberMe !== 'boolean')
    ) {
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
router.post('/register', controllers.register);

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
router.post('/login', validateLogin, controllers.login);
router.post('/refresh-token', controllers.refreshToken);

// Quên mật khẩu routes (public)
router.post('/forgot-password', controllers.requestPasswordReset);
router.post('/verify-reset-otp', controllers.verifyOTP);
router.post('/reset-password', controllers.resetPassword);

// Protected routes
router.post('/logout', authenticate, controllers.logout);

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
router.get('/me', authenticate, controllers.getMe);
router.get('/profile', authenticate, controllers.getProfile);

export default router;
