"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUsersByRole = exports.removePermissionFromRole = exports.addPermissionToRole = exports.deleteRole = exports.updateRole = exports.createRole = exports.getRoleByCode = exports.getRoleById = exports.getAllRoles = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
// 1. Lấy danh sách có phân trang và tìm kiếm
const getAllRoles = async (options) => {
    const { skip = 0, take = 10, filter, orderBy = { createdAt: 'desc' } } = options || {};
    const where = filter
        ? {
            OR: [
                { code: { contains: filter } },
                { name: { contains: filter } },
            ],
        }
        : {};
    const [data, total] = await Promise.all([
        prisma_1.default.roles.findMany({
            skip,
            take,
            where,
            orderBy,
            include: {
                rolePermissions: {
                    include: {
                        permission: true,
                    },
                },
                userRoles: {
                    include: {
                        user: true,
                    },
                },
            },
        }),
        prisma_1.default.roles.count({ where }),
    ]);
    return { data, total, skip, take };
};
exports.getAllRoles = getAllRoles;
// 2. Lấy chi tiết theo id
const getRoleById = async (id) => {
    const role = await prisma_1.default.roles.findUnique({
        where: { id },
        include: {
            rolePermissions: {
                include: {
                    permission: true,
                },
            },
            userRoles: {
                include: {
                    user: true,
                },
            },
        },
    });
    if (!role) {
        throw new Error(`Role with id ${id} not found`);
    }
    return role;
};
exports.getRoleById = getRoleById;
// 3. Lấy theo code
const getRoleByCode = async (code) => {
    return prisma_1.default.roles.findUnique({
        where: { code },
        include: {
            rolePermissions: {
                include: {
                    permission: true,
                },
            },
        },
    });
};
exports.getRoleByCode = getRoleByCode;
// 4. Tạo mới role với danh sách permissionIds
const createRole = async (payload) => {
    const { code, name, description, fieldPolicy, permissionIds = [] } = payload;
    // Kiểm tra trùng code
    const existing = await prisma_1.default.roles.findUnique({ where: { code } });
    if (existing) {
        throw new Error(`Role with code ${code} already exists`);
    }
    // Chuẩn hóa permissionIds thành bigint[]
    const ids = permissionIds.map(id => BigInt(id));
    return prisma_1.default.roles.create({
        data: {
            code,
            name,
            description,
            fieldPolicy,
            rolePermissions: {
                create: ids.map((permissionId) => ({
                    permission: { connect: { id: permissionId } },
                })),
            },
        },
        include: {
            rolePermissions: {
                include: { permission: true },
            },
        },
    });
};
exports.createRole = createRole;
// 5. Cập nhật role
const updateRole = async (id, payload) => {
    const { name, description, fieldPolicy, permissionIds } = payload;
    // Kiểm tra tồn tại
    const existing = await prisma_1.default.roles.findUnique({ where: { id } });
    if (!existing) {
        throw new Error(`Role with id ${id} not found`);
    }
    // Nếu đổi code, kiểm tra trùng
    if (payload.code && payload.code !== existing.code) {
        const conflict = await prisma_1.default.roles.findUnique({
            where: { code: payload.code },
        });
        if (conflict) {
            throw new Error(`Role with code ${payload.code} already exists`);
        }
    }
    return prisma_1.default.$transaction(async (tx) => {
        const role = await tx.roles.update({
            where: { id },
            data: {
                code: payload.code,
                name,
                description,
                fieldPolicy,
            },
        });
        // Cập nhật permissions nếu được cung cấp
        if (permissionIds !== undefined) {
            const ids = permissionIds.map(id => BigInt(id));
            // Xóa tất cả permission cũ
            await tx.rolePermissions.deleteMany({ where: { roleId: id } });
            // Thêm mới
            if (ids.length > 0) {
                await tx.rolePermissions.createMany({
                    data: ids.map((permissionId) => ({
                        roleId: id,
                        permissionId,
                    })),
                });
            }
        }
        // Trả về role kèm permissions
        return tx.roles.findUnique({
            where: { id },
            include: {
                rolePermissions: {
                    include: { permission: true },
                },
            },
        });
    });
};
exports.updateRole = updateRole;
// 6. Xóa role
const deleteRole = async (id) => {
    const existing = await prisma_1.default.roles.findUnique({ where: { id } });
    if (!existing) {
        throw new Error(`Role with id ${id} not found`);
    }
    return prisma_1.default.roles.delete({ where: { id } });
};
exports.deleteRole = deleteRole;
// 7. Gán một permission cho role (riêng lẻ)
const addPermissionToRole = async (roleId, permissionId) => {
    const role = await prisma_1.default.roles.findUnique({ where: { id: roleId } });
    if (!role)
        throw new Error(`Role ${roleId} not found`);
    const perm = await prisma_1.default.permissions.findUnique({ where: { id: permissionId } });
    if (!perm)
        throw new Error(`Permission ${permissionId} not found`);
    const existing = await prisma_1.default.rolePermissions.findUnique({
        where: {
            roleId_permissionId: { roleId, permissionId },
        },
    });
    if (existing) {
        throw new Error('Permission already assigned to this role');
    }
    return prisma_1.default.rolePermissions.create({
        data: { roleId, permissionId },
        include: { permission: true },
    });
};
exports.addPermissionToRole = addPermissionToRole;
// 8. Xóa một permission khỏi role (riêng lẻ)
const removePermissionFromRole = async (roleId, permissionId) => {
    const record = await prisma_1.default.rolePermissions.findUnique({
        where: {
            roleId_permissionId: { roleId, permissionId },
        },
    });
    if (!record) {
        throw new Error('Permission not assigned to this role');
    }
    return prisma_1.default.rolePermissions.delete({
        where: {
            roleId_permissionId: { roleId, permissionId },
        },
    });
};
exports.removePermissionFromRole = removePermissionFromRole;
// 9. Lấy danh sách user thuộc role
const getUsersByRole = async (roleId) => {
    const role = await prisma_1.default.roles.findUnique({ where: { id: roleId } });
    if (!role)
        throw new Error(`Role ${roleId} not found`);
    const userRoles = await prisma_1.default.userRoles.findMany({
        where: { roleId },
        include: { user: true },
    });
    return userRoles.map(ur => ur.user);
};
exports.getUsersByRole = getUsersByRole;
