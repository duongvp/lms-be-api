import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { randomUUID } from 'crypto';
import ApiError from '../../utils/ApiError';
import { getVietnamWallClockDate } from '../../utils/dateTime';
import { invalidateUserAccessCache } from '../../services/authorization.service';

type UserProgramScopeInput = {
    mode: 'ALL' | 'RESTRICTED' | 'DENY';
    programs?: string[];
};

type UserListQuery = {
    page: number;
    limit: number;
    keyword?: string;
};

type CreateAdminUserInput = {
    username: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    roleIds: number[];
    programScope?: UserProgramScopeInput;
};

const normalizeProgramScope = (scope?: UserProgramScopeInput) => {
    if (scope === undefined) return undefined;
    if (!scope || !['ALL', 'RESTRICTED', 'DENY'].includes(scope.mode)) {
        throw new ApiError('Phạm vi chương trình không hợp lệ', 400);
    }
    const programs = Array.from(new Set(
        (scope.programs || []).map((code) => String(code || '').trim()).filter(Boolean)
    )).sort();
    if (scope.mode === 'RESTRICTED' && !programs.length) {
        throw new ApiError('Vui lòng chọn ít nhất một chương trình', 400);
    }
    return { mode: scope.mode, programs };
};

const saveUserProgramScope = async (
    tx: Prisma.TransactionClient,
    userId: number,
    rawScope?: UserProgramScopeInput
) => {
    const scope = normalizeProgramScope(rawScope);
    if (!scope) return;

    if (scope.mode === 'RESTRICTED') {
        const existing = await tx.lessons.findMany({
            where: { subject_code: { in: scope.programs }, status: { not: 0 } },
            select: { subject_code: true },
            distinct: ['subject_code'],
        });
        const existingCodes = new Set(existing.map((row) => row.subject_code));
        const unknown = scope.programs.filter((code) => !existingCodes.has(code));
        if (unknown.length) throw new ApiError(`Chương trình không tồn tại: ${unknown.join(', ')}`, 400);
    }

    await tx.$executeRaw`DELETE FROM user_program_scopes WHERE userId = ${userId}`;
    await tx.$executeRaw`
        INSERT INTO user_program_scope_policies (userId, mode, createdAt, updatedAt)
        VALUES (${userId}, ${scope.mode}, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
        ON DUPLICATE KEY UPDATE mode = VALUES(mode), updatedAt = CURRENT_TIMESTAMP(3)
    `;
    if (scope.programs.length) {
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO scope_resources
                (scopeType, scopeKey, displayName, status, createdAt, updatedAt)
            SELECT 'PROGRAM', lesson.subject_code, MAX(lesson.subject_name),
                'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
            FROM lessons lesson
            WHERE lesson.status <> 0
              AND lesson.subject_code IN (${Prisma.join(scope.programs)})
            GROUP BY lesson.subject_code
            ON DUPLICATE KEY UPDATE
                displayName = VALUES(displayName),
                status = 'ACTIVE',
                updatedAt = CURRENT_TIMESTAMP(3)
        `);
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO user_program_scopes (userId, scopeResourceId, createdAt)
            SELECT ${userId}, resource.id, CURRENT_TIMESTAMP(3)
            FROM scope_resources resource
            WHERE resource.scopeType = 'PROGRAM'
              AND resource.scopeKey IN (${Prisma.join(scope.programs)})
        `);
    }
};

const serializeUser = (user: any) => ({
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
    roles: user.userRoles.map((ur: any) => ({
        role_id: Number(ur.role.id),
        role_code: ur.role.code,
        role_name: ur.role.name,
    })),
    programScope: user.userRoles.some((ur: any) => ur.role.code === 'admin')
      ? { mode: 'ALL', programs: [] }
      : user.programScopePolicy ? {
        mode: user.programScopePolicy.mode,
        programs: (user.programScopes || [])
            .map((scope: any) => scope.scopeResource?.scopeKey)
            .filter(Boolean)
            .sort(),
      } : { mode: 'DENY', programs: [] },
});

const UserService = {
    async createAdminUser(input: CreateAdminUserInput) {
        const username = String(input.username || '').trim();
        const name = String(input.name || '').trim();
        const email = String(input.email || '').trim() || null;
        const phone = String(input.phone || '').trim() || null;
        const roleIds = Array.from(new Set(input.roleIds.map(Number)));

        if (!username || username.length > 100) {
            throw new ApiError('Tên đăng nhập không hợp lệ', 400);
        }
        if (!name || name.length > 150) {
            throw new ApiError('Tên người dùng không hợp lệ', 400);
        }
        if (email && (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
            throw new ApiError('Email không hợp lệ', 400);
        }
        if (phone && phone.length > 20) {
            throw new ApiError('Số điện thoại không được vượt quá 20 ký tự', 400);
        }
        if (!roleIds.length || roleIds.some((roleId) => !Number.isInteger(roleId) || roleId <= 0)) {
            throw new ApiError('Vui lòng chọn ít nhất một vai trò hợp lệ', 400);
        }

        let userId: number;
        try {
            userId = await prisma.$transaction(async (tx) => {
                // Username có thể lặp trong bảng users theo code/learn_number.
                // Chỉ chặn khi đã có bất kỳ user cùng username được gán role.
                const assignedUser = await tx.userRoles.findFirst({
                    where: { user: { username } },
                    select: { userId: true },
                });
                if (assignedUser) {
                    throw new ApiError('Tên đăng nhập đã được gán vai trò quản trị', 409);
                }

                const roles = await tx.roles.findMany({
                    where: {
                        id: { in: roleIds.map((roleId) => BigInt(roleId)) },
                        isActive: true,
                    },
                    select: { id: true },
                });
                if (roles.length !== roleIds.length) {
                    throw new ApiError('Có vai trò không tồn tại hoặc đã ngừng hoạt động', 400);
                }

                // Luôn tạo một dòng quản trị độc lập. Code kỹ thuật riêng giúp
                // không trùng khóa ghép và không đụng tới dòng học viên/gói bán.
                const user = await tx.users.create({
                    data: {
                        username,
                        name,
                        email,
                        phone,
                        code: `LMS_ADMIN_${randomUUID()}`,
                        learn_number: 0,
                        islearn: 0,
                        created_at: getVietnamWallClockDate(),
                        updated_at: getVietnamWallClockDate(),
                    },
                });

                await tx.userRoles.createMany({
                    data: roleIds.map((roleId) => ({
                        userId: user.id,
                        roleId: BigInt(roleId),
                    })),
                    skipDuplicates: true,
                });
                await saveUserProgramScope(
                    tx,
                    user.id,
                    input.programScope || { mode: 'DENY', programs: [] }
                );

                return user.id;
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            if (
                error instanceof Prisma.PrismaClientKnownRequestError
                && error.code === 'P2002'
            ) {
                throw new ApiError('Không thể tạo người dùng do trùng khóa username/code/learn_number', 409);
            }
            throw error;
        }

        invalidateUserAccessCache(userId);
        return this.getUserById(userId);
    },

    async getAllUsers({ page, limit, keyword }: UserListQuery) {
        try {
            const where: Prisma.usersWhereInput = {
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
                        programScopePolicy: true,
                        programScopes: { include: { scopeResource: true } },
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
        } catch (error) {
            throw new ApiError('Failed to fetch users', 500);
        }
    },

    async getUserById(userId: number) {
        try {
            const user = await prisma.users.findUnique({
                where: { id: userId },
                include: {
                    programScopePolicy: true,
                    programScopes: { include: { scopeResource: true } },
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

            return serializeUser(user);
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
            // Username được phép trùng trong users, nhưng không được trùng với
            // một tài khoản quản trị khác đã có user_roles.
            if (data.username !== undefined && data.username !== existingUser.username) {
                const duplicate = await prisma.userRoles.findFirst({
                    where: {
                        userId: { not: userId },
                        user: { username: data.username },
                    },
                });
                if (duplicate) {
                    throw new ApiError('Tên đăng nhập đã được gán vai trò quản trị', 409);
                }
                updateData.username = data.username;
            }
            // Cập nhật các trường khác nếu có (islearn, class_id, room_id...)
            if (data.islearn !== undefined) updateData.islearn = data.islearn;
            if (data.class_id !== undefined) updateData.class_id = data.class_id;
            if (data.room_id !== undefined) updateData.room_id = data.room_id;
            // users.updated_at chưa khai báo @updatedAt trong Prisma schema.
            updateData.updated_at = getVietnamWallClockDate();

            await prisma.$transaction(async (tx) => {
                await tx.users.update({ where: { id: userId }, data: updateData });

                if (data.roleIds !== undefined) {
                    if (!Array.isArray(data.roleIds)) throw new ApiError('Vai trò không hợp lệ', 400);
                    const roleIds: number[] = Array.from(new Set<number>(data.roleIds.map(Number)));
                    if (!roleIds.length || roleIds.some((id) => !Number.isInteger(id) || id <= 0)) {
                        throw new ApiError('Vui lòng chọn ít nhất một vai trò hợp lệ', 400);
                    }
                    const roles = await tx.roles.findMany({
                        where: { id: { in: roleIds.map((id) => BigInt(id)) }, isActive: true },
                        select: { id: true },
                    });
                    if (roles.length !== roleIds.length) {
                        throw new ApiError('Có vai trò không tồn tại hoặc đã ngừng hoạt động', 400);
                    }
                    await tx.userRoles.deleteMany({ where: { userId } });
                    await tx.userRoles.createMany({
                        data: roleIds.map((roleId) => ({ userId, roleId: BigInt(roleId) })),
                    });
                }

                await saveUserProgramScope(tx, userId, data.programScope);
            });

            // Lấy lại user với roles
            invalidateUserAccessCache(userId);
            return await UserService.getUserById(userId);
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            throw new ApiError(error.message || 'Failed to update user', 500);
        }
    },

    async deleteAdminUser(userId: number, actorUserId: number) {
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new ApiError('Người dùng không hợp lệ', 400);
        }
        if (userId === actorUserId) {
            throw new ApiError('Không thể xóa tài khoản đang đăng nhập', 400);
        }

        return prisma.$transaction(async (tx) => {
            const user = await tx.users.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    username: true,
                    code: true,
                    _count: { select: { userRoles: true } },
                },
            });
            if (!user || user._count.userRoles === 0) {
                throw new ApiError('Tài khoản quản trị không tồn tại', 404);
            }

            // Thu hồi toàn bộ phiên trước khi gỡ quyền/xóa tài khoản.
            await tx.auth_sessions.deleteMany({ where: { user_id: userId } });
            await tx.userRoles.deleteMany({ where: { userId } });

            // Chỉ hard-delete dòng do màn quản trị tạo. Với dữ liệu cũ từng gán
            // role vào dòng học viên, chỉ gỡ role để không ảnh hưởng gói bán.
            const deletedUserRecord = user.code.startsWith('LMS_ADMIN_');
            if (deletedUserRecord) {
                await tx.users.delete({ where: { id: userId } });
            }

            return {
                success: true,
                deletedUserRecord,
                message: deletedUserRecord
                    ? `Đã xóa tài khoản '${user.username}'`
                    : `Đã gỡ quyền quản trị của tài khoản '${user.username}'`,
            };
        });
    },

    // Chưa hỗ trợ toggle trạng thái do schema không có cột is_active.
};

export default UserService;
