"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const field_permission_service_1 = __importDefault(require("./field-permission.service"));
const rbac_ui_constants_1 = require("./rbac-ui.constants");
const prisma = new client_1.PrismaClient();
const ACTION_LABELS = {
    view: 'Xem DS',
    create: 'Thêm mới',
    update: 'Cập nhật',
    delete: 'Xoá',
    import: 'Nhập file',
    export: 'Xuất file',
    approve: 'Duyệt',
    grade: 'Chấm điểm',
    reset_password: 'Đặt lại mật khẩu',
    status: 'Đổi trạng thái',
    'teacher.view': 'Xem phân công',
    'teacher.assign': 'Gán phân công',
    'teacher.update': 'Sửa phân công',
    'teacher.remove': 'Gỡ phân công',
    // thêm các action khác nếu cần
};
// Hàm lấy tên hiển thị từ action code
function getActionLabel(action) {
    return ACTION_LABELS[action] || action;
}
const RoleService = {
    async getAllRoles() {
        try {
            const roles = await prisma.roles.findMany({
                where: { isActive: true },
            });
            // Convert BigInt to Number
            return roles.map(role => ({
                ...role,
                id: Number(role.id)
            }));
        }
        catch (error) {
            throw new ApiError_1.default('Failed to fetch roles', 500);
        }
    },
    async getRoleById(roleId) {
        try {
            const id = BigInt(roleId);
            const role = await prisma.roles.findUnique({
                where: { id },
                include: {
                    rolePermissions: {
                        include: {
                            permission: true
                        }
                    }
                }
            });
            if (!role) {
                throw new ApiError_1.default('Role not found', 404);
            }
            return {
                id: Number(role.id),
                code: role.code,
                name: role.name,
                description: role.description,
                isActive: role.isActive,
                fieldPolicy: role.fieldPolicy, // <-- thêm dòng này
                permissions: role.rolePermissions.map(rp => ({
                    key: rp.permission.code,
                    name: rp.permission.name
                })),
            };
        }
        catch (error) {
            if (error instanceof ApiError_1.default)
                throw error;
            console.error(error);
            throw new ApiError_1.default('Failed to fetch role', 500);
        }
    },
    async createRoleWithPermissions(roleData) {
        try {
            return await prisma.$transaction(async (tx) => {
                // 1. Check if code or name exists
                const code = roleData.code || roleData.role_name.toLowerCase().replace(/\s+/g, '_');
                const name = roleData.role_name || roleData.name;
                const existingRole = await tx.roles.findFirst({
                    where: {
                        OR: [
                            { code: code },
                            { name: name }
                        ]
                    }
                });
                if (existingRole) {
                    throw new ApiError_1.default('Role name or code already exists', 400);
                }
                // 2. Validate permissions if provided
                let validPermissions = [];
                if (roleData.permissions && roleData.permissions.length > 0) {
                    const permissionKeys = roleData.permissions.map((p) => p.key || p.code);
                    validPermissions = await tx.permissions.findMany({
                        where: {
                            code: { in: permissionKeys }
                        }
                    });
                    if (validPermissions.length !== permissionKeys.length) {
                        const foundKeys = validPermissions.map(p => p.code);
                        const missingKeys = permissionKeys.filter((key) => !foundKeys.includes(key));
                        throw new ApiError_1.default(`Permissions not found: ${missingKeys.join(', ')}`, 400);
                    }
                }
                const fieldPolicy = roleData.fieldPolicy
                    ? await field_permission_service_1.default.validateFieldPolicy(roleData.fieldPolicy)
                    : undefined;
                // 3. Create role with nested relations
                const newRole = await tx.roles.create({
                    data: {
                        code: code,
                        name: name,
                        description: roleData.description || null,
                        fieldPolicy,
                        rolePermissions: {
                            create: validPermissions.map(p => ({
                                permissionId: p.id
                            }))
                        }
                    },
                    include: {
                        rolePermissions: {
                            include: {
                                permission: true
                            }
                        }
                    }
                });
                return {
                    success: true,
                    role_id: Number(newRole.id),
                    role: {
                        id: Number(newRole.id),
                        code: newRole.code,
                        name: newRole.name,
                        fieldPolicy: newRole.fieldPolicy,
                        permissions: newRole.rolePermissions.map(rp => rp.permission.code)
                    }
                };
            });
        }
        catch (error) {
            if (error instanceof ApiError_1.default)
                throw error;
            throw new ApiError_1.default('Failed to create role: ' + error.message, 500);
        }
    },
    async updateRoleWithPermissions(roleId, roleData) {
        try {
            const id = BigInt(roleId);
            return await prisma.$transaction(async (tx) => {
                // 1. Check existing role
                const existingRole = await tx.roles.findUnique({
                    where: { id }
                });
                if (!existingRole) {
                    throw new ApiError_1.default('Role not found', 404);
                }
                const name = roleData.role_name || roleData.name;
                const updateData = {};
                if (name)
                    updateData.name = name;
                if (roleData.description !== undefined)
                    updateData.description = roleData.description;
                if (roleData.fieldPolicy !== undefined) {
                    updateData.fieldPolicy = await field_permission_service_1.default.validateFieldPolicy(roleData.fieldPolicy);
                }
                // 2. Handle permissions update if provided
                if (roleData.permissions) {
                    // Delete old permissions
                    await tx.rolePermissions.deleteMany({
                        where: { roleId: id }
                    });
                    const permissionKeys = roleData.permissions.map((p) => p.key || p.code);
                    const validPermissions = await tx.permissions.findMany({
                        where: {
                            code: { in: permissionKeys }
                        }
                    });
                    if (validPermissions.length !== permissionKeys.length) {
                        const foundKeys = validPermissions.map(p => p.code);
                        const missingKeys = permissionKeys.filter((key) => !foundKeys.includes(key));
                        throw new ApiError_1.default(`Permissions not found: ${missingKeys.join(', ')}`, 400);
                    }
                    // Assign new permissions
                    updateData.rolePermissions = {
                        create: validPermissions.map(p => ({
                            permissionId: p.id
                        }))
                    };
                }
                // 3. Execute update
                const updatedRole = await tx.roles.update({
                    where: { id },
                    data: updateData,
                    include: {
                        rolePermissions: {
                            include: { permission: true }
                        }
                    }
                });
                return {
                    success: true,
                    role: {
                        id: Number(updatedRole.id),
                        code: updatedRole.code,
                        name: updatedRole.name,
                        description: updatedRole.description,
                        fieldPolicy: updatedRole.fieldPolicy,
                        permissions: updatedRole.rolePermissions.map(rp => ({
                            key: rp.permission.code,
                            name: rp.permission.name
                        }))
                    }
                };
            });
        }
        catch (error) {
            if (error instanceof ApiError_1.default)
                throw error;
            throw new ApiError_1.default('Failed to update role: ' + error.message, 500);
        }
    },
    async deleteRole(roleId) {
        try {
            const id = BigInt(roleId);
            return await prisma.$transaction(async (tx) => {
                const role = await tx.roles.findUnique({
                    where: { id },
                    include: { userRoles: true }
                });
                if (!role) {
                    throw new ApiError_1.default('Role not found', 404);
                }
                if (role.userRoles && role.userRoles.length > 0) {
                    const userIds = role.userRoles.map(ur => ur.userId);
                    // We assume users table has is_deleted or we fallback if it doesn't.
                    // For safety, let's just use queryRaw because schema might not have users fully defined here.
                    const activeUsers = await tx.$queryRawUnsafe(`SELECT COUNT(*) as count FROM users WHERE id IN (?) AND is_deleted = 0`, userIds);
                    const count = Number(activeUsers[0]?.count || 0);
                    if (count > 0) {
                        throw new ApiError_1.default('Cannot delete role that is assigned to active users', 400);
                    }
                    // Soft delete
                    await tx.roles.update({
                        where: { id },
                        data: { isActive: false }
                    });
                    return {
                        success: true,
                        message: `Soft deleted role '${role.name}' because it's assigned to deleted users`
                    };
                }
                // Hard delete
                await tx.roles.delete({
                    where: { id }
                });
                return {
                    success: true,
                    message: `Deleted role '${role.name}'`
                };
            });
        }
        catch (error) {
            if (error instanceof ApiError_1.default)
                throw error;
            throw new ApiError_1.default('Failed to delete role: ' + error.message, 500);
        }
    },
    async getModulesStructure() {
        try {
            const modules = await prisma.modules.findMany({
                where: {
                    code: { in: [...rbac_ui_constants_1.RBAC_FIELD_MODULE_CODES] },
                },
                include: {
                    fields: {
                        orderBy: { sortOrder: 'asc' },
                        select: {
                            id: true,
                            fieldCode: true,
                            fieldLabel: true,
                            fieldType: true,
                            sortOrder: true,
                        },
                    },
                },
            });
            const moduleOrder = new Map(rbac_ui_constants_1.RBAC_FIELD_MODULE_CODES.map((code, index) => [code, index]));
            return modules
                .sort((left, right) => (moduleOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER)
                - (moduleOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER))
                .map(mod => ({
                id: Number(mod.id),
                code: mod.code,
                name: mod.name,
                fields: mod.fields.map(field => ({
                    ...field,
                    id: Number(field.id),
                })),
            }));
        }
        catch (error) {
            throw new ApiError_1.default('Failed to fetch modules structure', 500);
        }
    },
    async getPermissionsStructure() {
        try {
            const permissions = await prisma.permissions.findMany({
                where: {
                    OR: rbac_ui_constants_1.RBAC_MENU_MODULE_CODES.map((moduleCode) => ({
                        code: { startsWith: `${moduleCode}.` },
                    })),
                },
                orderBy: { code: 'asc' },
            });
            // Nhóm permissions theo module (phần đầu của code trước dấu '.')
            const structure = {};
            for (const perm of permissions) {
                const parts = perm.code.split('.');
                if (parts.length < 2)
                    continue; // bỏ qua nếu không đúng format
                const moduleCode = parts[0];
                if (!rbac_ui_constants_1.RBAC_MENU_MODULE_CODES.includes(moduleCode))
                    continue;
                const action = parts.slice(1).join('.'); // vì có thể có action phức như 'reset_password'
                const groupName = rbac_ui_constants_1.RBAC_MENU_LABELS[moduleCode];
                if (!structure[groupName]) {
                    structure[groupName] = {};
                }
                // Mỗi module chỉ có 1 menu cùng tên (hoặc có thể tạo menu con nếu sau này cần)
                const menuName = groupName; // dùng chính tên module làm menu
                if (!structure[groupName][menuName]) {
                    structure[groupName][menuName] = {
                        actions: [],
                        keys: [],
                    };
                }
                structure[groupName][menuName].actions.push(getActionLabel(action));
                structure[groupName][menuName].keys.push(perm.code);
            }
            return structure;
        }
        catch (error) {
            throw new ApiError_1.default('Failed to fetch permissions structure', 500);
        }
    },
};
exports.default = RoleService;
