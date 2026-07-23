"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removePermissionFromRole = exports.assignPermissionToRole = exports.getPermissionsByRole = exports.deletePermission = exports.updatePermission = exports.createPermission = exports.getPermissionByCode = exports.getPermissionById = exports.getAllPermissions = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
// Hàm lấy danh sách có phân trang
const getAllPermissions = async (options) => {
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
        prisma_1.default.permissions.findMany({
            skip,
            take,
            where,
            orderBy,
            include: {
                rolePermissions: {
                    include: {
                        role: true,
                    },
                },
            },
        }),
        prisma_1.default.permissions.count({ where }),
    ]);
    return { data, total, skip, take };
};
exports.getAllPermissions = getAllPermissions;
// Lấy một permission theo id, ném lỗi nếu không tìm thấy
const getPermissionById = async (id) => {
    const permission = await prisma_1.default.permissions.findUnique({
        where: { id },
        include: {
            rolePermissions: {
                include: {
                    role: true,
                },
            },
        },
    });
    if (!permission) {
        throw new Error(`Permission with id ${id} not found`); // hoặc dùng NotFoundException nếu có
    }
    return permission;
};
exports.getPermissionById = getPermissionById;
// Lấy theo code
const getPermissionByCode = async (code) => {
    return prisma_1.default.permissions.findUnique({
        where: { code },
        include: {
            rolePermissions: {
                include: {
                    role: true,
                },
            },
        },
    });
};
exports.getPermissionByCode = getPermissionByCode;
// Tạo mới, kiểm tra trùng code
const createPermission = async (payload) => {
    const existing = await prisma_1.default.permissions.findUnique({
        where: { code: payload.code },
    });
    if (existing) {
        throw new Error(`Permission with code ${payload.code} already exists`);
    }
    return prisma_1.default.permissions.create({
        data: payload,
    });
};
exports.createPermission = createPermission;
// Cập nhật, kiểm tra tồn tại và trùng code (nếu thay đổi code)
const updatePermission = async (id, payload) => {
    // Kiểm tra tồn tại
    const existing = await prisma_1.default.permissions.findUnique({ where: { id } });
    if (!existing) {
        throw new Error(`Permission with id ${id} not found`);
    }
    // Nếu có thay đổi code, kiểm tra trùng
    if (payload.code && payload.code !== existing.code) {
        const conflict = await prisma_1.default.permissions.findUnique({
            where: { code: payload.code },
        });
        if (conflict) {
            throw new Error(`Permission with code ${payload.code} already exists`);
        }
    }
    return prisma_1.default.permissions.update({
        where: { id },
        data: payload,
    });
};
exports.updatePermission = updatePermission;
// Xóa, kiểm tra tồn tại (cascade sẽ xóa rolePermissions)
const deletePermission = async (id) => {
    const existing = await prisma_1.default.permissions.findUnique({ where: { id } });
    if (!existing) {
        throw new Error(`Permission with id ${id} not found`);
    }
    return prisma_1.default.permissions.delete({ where: { id } });
};
exports.deletePermission = deletePermission;
// Lấy danh sách permissions gán cho một role
const getPermissionsByRole = async (roleId) => {
    const rolePermissions = await prisma_1.default.rolePermissions.findMany({
        where: { roleId },
        include: {
            permission: true,
        },
    });
    return rolePermissions.map(rp => rp.permission);
};
exports.getPermissionsByRole = getPermissionsByRole;
// Gán permission vào role
const assignPermissionToRole = async (roleId, permissionId) => {
    // Kiểm tra tồn tại của role và permission không cần thiết vì FK sẽ báo lỗi, nhưng có thể check để báo lỗi rõ
    const role = await prisma_1.default.roles.findUnique({ where: { id: roleId } });
    if (!role)
        throw new Error(`Role ${roleId} not found`);
    const perm = await prisma_1.default.permissions.findUnique({ where: { id: permissionId } });
    if (!perm)
        throw new Error(`Permission ${permissionId} not found`);
    // Kiểm tra đã tồn tại
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
exports.assignPermissionToRole = assignPermissionToRole;
// Xóa permission khỏi role
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
