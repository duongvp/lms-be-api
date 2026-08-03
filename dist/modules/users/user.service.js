"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const prisma = new client_1.PrismaClient();
const serializeUser = (user) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    phone: user.phone,
    code: user.code,
    learn_number: user.learn_number,
    class_id: user.class_id,
    room_id: user.room_id,
    islearn: user.islearn,
    created_at: user.created_at,
    updated_at: user.updated_at,
    is_active: true,
    roles: user.userRoles.map((ur) => ({
        role_id: Number(ur.role.id),
        role_code: ur.role.code,
        role_name: ur.role.name,
    })),
});
const UserService = {
    async createAdminUser(input) {
        const username = String(input.username || '').trim();
        const name = String(input.name || '').trim();
        const email = String(input.email || '').trim() || null;
        const phone = String(input.phone || '').trim() || null;
        const roleIds = Array.from(new Set(input.roleIds.map(Number)));
        if (!username || username.length > 100) {
            throw new ApiError_1.default('Tên đăng nhập không hợp lệ', 400);
        }
        if (!name || name.length > 150) {
            throw new ApiError_1.default('Tên người dùng không hợp lệ', 400);
        }
        if (email && (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
            throw new ApiError_1.default('Email không hợp lệ', 400);
        }
        if (phone && phone.length > 20) {
            throw new ApiError_1.default('Số điện thoại không được vượt quá 20 ký tự', 400);
        }
        if (!roleIds.length || roleIds.some((roleId) => !Number.isInteger(roleId) || roleId <= 0)) {
            throw new ApiError_1.default('Vui lòng chọn ít nhất một vai trò hợp lệ', 400);
        }
        const userId = await prisma.$transaction(async (tx) => {
            const roles = await tx.roles.findMany({
                where: {
                    id: { in: roleIds.map((roleId) => BigInt(roleId)) },
                    isActive: true,
                },
                select: { id: true },
            });
            if (roles.length !== roleIds.length) {
                throw new ApiError_1.default('Có vai trò không tồn tại hoặc đã ngừng hoạt động', 400);
            }
            let user = await tx.users.findFirst({
                where: { username },
                orderBy: [
                    { code: 'asc' },
                    { learn_number: 'asc' },
                    { id: 'asc' },
                ],
                include: { userRoles: true },
            });
            if (user?.userRoles.length) {
                throw new ApiError_1.default('Tài khoản này đã được gán vai trò quản trị', 400);
            }
            if (!user) {
                user = await tx.users.create({
                    data: {
                        username,
                        name,
                        email,
                        phone,
                        code: '',
                        learn_number: 0,
                        islearn: 0,
                    },
                    include: { userRoles: true },
                });
            }
            await tx.userRoles.createMany({
                data: roleIds.map((roleId) => ({
                    userId: user.id,
                    roleId: BigInt(roleId),
                })),
                skipDuplicates: true,
            });
            return user.id;
        });
        return this.getUserById(userId);
    },
    async getAllUsers({ page, limit, keyword }) {
        try {
            const where = {
                userRoles: { some: {} },
                ...(keyword
                    ? {
                        OR: [
                            { username: { contains: keyword } },
                            { name: { contains: keyword } },
                            { email: { contains: keyword } },
                        ],
                    }
                    : {}),
            };
            const [users, total] = await Promise.all([
                prisma.users.findMany({
                    where,
                    skip: (page - 1) * limit,
                    take: limit,
                    include: {
                        userRoles: {
                            include: {
                                role: {
                                    select: {
                                        id: true,
                                        code: true,
                                        name: true,
                                    },
                                },
                            },
                        },
                    },
                    orderBy: { id: 'asc' },
                }),
                prisma.users.count({ where }),
            ]);
            return {
                data: users.map(serializeUser),
                total,
                page,
                limit,
            };
        }
        catch (error) {
            throw new ApiError_1.default('Failed to fetch users', 500);
        }
    },
    async getUserById(userId) {
        try {
            const user = await prisma.users.findUnique({
                where: { id: userId },
                include: {
                    userRoles: {
                        include: {
                            role: {
                                select: {
                                    id: true,
                                    code: true,
                                    name: true,
                                },
                            },
                        },
                    },
                },
            });
            if (!user) {
                throw new ApiError_1.default('User not found', 404);
            }
            return serializeUser(user);
        }
        catch (error) {
            if (error instanceof ApiError_1.default)
                throw error;
            throw new ApiError_1.default('Failed to fetch user', 500);
        }
    },
    async updateUser(userId, data) {
        try {
            // Kiểm tra user tồn tại
            const existingUser = await prisma.users.findUnique({
                where: { id: userId },
            });
            if (!existingUser) {
                throw new ApiError_1.default('User not found', 404);
            }
            // Tách các trường cần update (không cho update code, learn_number... nếu cần)
            const updateData = {};
            if (data.name !== undefined)
                updateData.name = data.name;
            if (data.email !== undefined)
                updateData.email = data.email;
            if (data.phone !== undefined)
                updateData.phone = data.phone;
            // Username có thể cần unique, ta kiểm tra nếu có thay đổi
            if (data.username !== undefined && data.username !== existingUser.username) {
                const duplicate = await prisma.users.findFirst({
                    where: { username: data.username, id: { not: userId } },
                });
                if (duplicate)
                    throw new ApiError_1.default('Username already exists', 400);
                updateData.username = data.username;
            }
            // Cập nhật các trường khác nếu có (islearn, class_id, room_id...)
            if (data.islearn !== undefined)
                updateData.islearn = data.islearn;
            if (data.class_id !== undefined)
                updateData.class_id = data.class_id;
            if (data.room_id !== undefined)
                updateData.room_id = data.room_id;
            // Cập nhật thông tin cơ bản
            const updatedUser = await prisma.users.update({
                where: { id: userId },
                data: updateData,
            });
            // Xử lý roles nếu có
            if (data.roleIds && Array.isArray(data.roleIds)) {
                // Kiểm tra role tồn tại
                const roles = await prisma.roles.findMany({
                    where: { id: { in: data.roleIds.map((id) => BigInt(id)) } },
                });
                if (roles.length !== data.roleIds.length) {
                    throw new ApiError_1.default('One or more roles not found', 400);
                }
                // Xóa userRoles cũ
                await prisma.userRoles.deleteMany({ where: { userId } });
                // Thêm mới
                await prisma.userRoles.createMany({
                    data: data.roleIds.map((roleId) => ({
                        userId,
                        roleId: BigInt(roleId),
                    })),
                });
            }
            // Lấy lại user với roles
            return await UserService.getUserById(userId);
        }
        catch (error) {
            if (error instanceof ApiError_1.default)
                throw error;
            throw new ApiError_1.default(error.message || 'Failed to update user', 500);
        }
    },
    // Tạm thời bỏ delete và toggle status do schema chưa có cột is_deleted/is_active
    // Bạn có thể thêm vào schema nếu cần
};
exports.default = UserService;
