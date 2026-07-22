import { PrismaClient, Prisma } from '@prisma/client';
import ApiError from '../../utils/ApiError';

const prisma = new PrismaClient();

const UserService = {
    async getAllUsers() {
        try {
            const users = await prisma.users.findMany({
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
            });

            return users.map((user) => ({
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
                    role_id: Number(ur.role.id),   // BigInt -> number
                    role_code: ur.role.code,
                    role_name: ur.role.name,
                })),
            }));
        } catch (error) {
            throw new ApiError('Failed to fetch users', 500);
        }
    },

    async getUserById(userId: number) {
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
                throw new ApiError('User not found', 404);
            }

            return {
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
                roles: user.userRoles.map((ur) => ({
                    role_id: Number(ur.role.id),
                    role_code: ur.role.code,
                    role_name: ur.role.name,
                })),
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new ApiError('Failed to fetch user', 500);
        }
    },

    async updateUser(userId: number, data: any) {
        try {
            // Kiểm tra user tồn tại
            const existingUser = await prisma.users.findUnique({
                where: { id: userId },
            });
            if (!existingUser) {
                throw new ApiError('User not found', 404);
            }

            // Tách các trường cần update (không cho update code, learn_number... nếu cần)
            const updateData: any = {};
            if (data.name !== undefined) updateData.name = data.name;
            if (data.email !== undefined) updateData.email = data.email;
            if (data.phone !== undefined) updateData.phone = data.phone;
            // Username có thể cần unique, ta kiểm tra nếu có thay đổi
            if (data.username !== undefined && data.username !== existingUser.username) {
                const duplicate = await prisma.users.findFirst({
                    where: { username: data.username, id: { not: userId } },
                });
                if (duplicate) throw new ApiError('Username already exists', 400);
                updateData.username = data.username;
            }
            // Cập nhật các trường khác nếu có (islearn, class_id, room_id...)
            if (data.islearn !== undefined) updateData.islearn = data.islearn;
            if (data.class_id !== undefined) updateData.class_id = data.class_id;
            if (data.room_id !== undefined) updateData.room_id = data.room_id;

            // Cập nhật thông tin cơ bản
            const updatedUser = await prisma.users.update({
                where: { id: userId },
                data: updateData,
            });

            // Xử lý roles nếu có
            if (data.roleIds && Array.isArray(data.roleIds)) {
                // Kiểm tra role tồn tại
                const roles = await prisma.roles.findMany({
                    where: { id: { in: data.roleIds.map((id: number) => BigInt(id)) } },
                });
                if (roles.length !== data.roleIds.length) {
                    throw new ApiError('One or more roles not found', 400);
                }

                // Xóa userRoles cũ
                await prisma.userRoles.deleteMany({ where: { userId } });

                // Thêm mới
                await prisma.userRoles.createMany({
                    data: data.roleIds.map((roleId: number) => ({
                        userId,
                        roleId: BigInt(roleId),
                    })),
                });
            }

            // Lấy lại user với roles
            return await UserService.getUserById(userId);
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(error.message || 'Failed to update user', 500);
        }
    },

    // Tạm thời bỏ delete và toggle status do schema chưa có cột is_deleted/is_active
    // Bạn có thể thêm vào schema nếu cần
};

export default UserService;