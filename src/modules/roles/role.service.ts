import { PrismaClient } from '@prisma/client';
import ApiError from '../../utils/ApiError';
import FieldPermissionService from './field-permission.service';
import { getVietnamWallClockDate } from '../../utils/dateTime';
import {
    RBAC_FIELD_MODULE_CODES,
    RBAC_MENU_LABELS,
    RBAC_MENU_MODULE_CODES,
} from './rbac-ui.constants';

const prisma = new PrismaClient();

const ACTION_LABELS: Record<string, string> = {
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
function getActionLabel(action: string): string {
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
        } catch (error) {
            throw new ApiError('Failed to fetch roles', 500);
        }
    },

    async getRoleById(roleId: string | number) {
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
                throw new ApiError('Role not found', 404);
            }

            return {
                id: Number(role.id),
                code: role.code,
                name: role.name,
                description: role.description,
                isActive: role.isActive,
                fieldPolicy: role.fieldPolicy,  // <-- thêm dòng này
                permissions: role.rolePermissions.map(rp => ({
                    key: rp.permission.code,
                    name: rp.permission.name
                })),
            };
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            console.error(error);
            throw new ApiError('Failed to fetch role', 500);
        }
    },

    async createRoleWithPermissions(roleData: any) {
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
                    throw new ApiError('Role name or code already exists', 400);
                }

                // 2. Validate permissions if provided
                let validPermissions: any[] = [];
                if (roleData.permissions && roleData.permissions.length > 0) {
                    const permissionKeys = roleData.permissions.map((p: any) => p.key || p.code);
                    validPermissions = await tx.permissions.findMany({
                        where: {
                            code: { in: permissionKeys }
                        }
                    });

                    if (validPermissions.length !== permissionKeys.length) {
                        const foundKeys = validPermissions.map(p => p.code);
                        const missingKeys = permissionKeys.filter((key: string) => !foundKeys.includes(key));
                        throw new ApiError(`Permissions not found: ${missingKeys.join(', ')}`, 400);
                    }
                }

                const fieldPolicy = roleData.fieldPolicy
                    ? await FieldPermissionService.validateFieldPolicy(roleData.fieldPolicy)
                    : undefined;

                // 3. Create role with nested relations
                const newRole = await tx.roles.create({
                    data: {
                        code: code,
                        name: name,
                        description: roleData.description || null,
                        fieldPolicy,
                        createdAt: getVietnamWallClockDate(),
                        updatedAt: getVietnamWallClockDate(),
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
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            throw new ApiError('Failed to create role: ' + error.message, 500);
        }
    },

    async updateRoleWithPermissions(roleId: string | number, roleData: any) {
        try {
            const id = BigInt(roleId);
            return await prisma.$transaction(async (tx) => {
                // 1. Check existing role
                const existingRole = await tx.roles.findUnique({
                    where: { id }
                });

                if (!existingRole) {
                    throw new ApiError('Role not found', 404);
                }

                const name = roleData.role_name || roleData.name;
                const updateData: any = {};
                updateData.updatedAt = getVietnamWallClockDate();
                if (name) updateData.name = name;
                if (roleData.description !== undefined) updateData.description = roleData.description;
                if (roleData.fieldPolicy !== undefined) {
                    updateData.fieldPolicy = await FieldPermissionService.validateFieldPolicy(roleData.fieldPolicy);
                }

                // 2. Handle permissions update if provided
                if (roleData.permissions) {
                    // Delete old permissions
                    await tx.rolePermissions.deleteMany({
                        where: { roleId: id }
                    });

                    const permissionKeys = roleData.permissions.map((p: any) => p.key || p.code);
                    const validPermissions = await tx.permissions.findMany({
                        where: {
                            code: { in: permissionKeys }
                        }
                    });

                    if (validPermissions.length !== permissionKeys.length) {
                        const foundKeys = validPermissions.map(p => p.code);
                        const missingKeys = permissionKeys.filter((key: string) => !foundKeys.includes(key));
                        throw new ApiError(`Permissions not found: ${missingKeys.join(', ')}`, 400);
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
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            throw new ApiError('Failed to update role: ' + error.message, 500);
        }
    },

    async deleteRole(roleId: string | number) {
        try {
            const id = BigInt(roleId);
            return await prisma.$transaction(async (tx) => {
                const role = await tx.roles.findUnique({
                    where: { id },
                    select: {
                        id: true,
                        name: true,
                        _count: { select: { userRoles: true } },
                    },
                });

                if (!role) {
                    throw new ApiError('Vai trò không tồn tại', 404);
                }

                if (role._count.userRoles > 0) {
                    throw new ApiError(
                        `Không thể xóa vai trò '${role.name}' vì đang được gán cho ${role._count.userRoles} người dùng`,
                        409
                    );
                }

                await tx.roles.delete({
                    where: { id }
                });

                return {
                    success: true,
                    message: `Đã xóa vai trò '${role.name}'`
                };
            });
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            throw new ApiError('Failed to delete role: ' + error.message, 500);
        }
    },
    async getModulesStructure() {
        try {
            const modules = await prisma.modules.findMany({
                where: {
                    code: { in: [...RBAC_FIELD_MODULE_CODES] },
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

            const moduleOrder = new Map<string, number>(
                RBAC_FIELD_MODULE_CODES.map((code, index) => [code, index])
            );
            return modules
            .sort((left, right) =>
                (moduleOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER)
                - (moduleOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER)
            )
            .map(mod => ({
                id: Number(mod.id),
                code: mod.code,
                name: mod.name,
                fields: mod.fields.map(field => ({
                    ...field,
                    id: Number(field.id),
                })),
            }));
        } catch (error) {
            throw new ApiError('Failed to fetch modules structure', 500);
        }
    },

    async getPermissionsStructure() {
        try {
            const permissions = await prisma.permissions.findMany({
                where: {
                    OR: RBAC_MENU_MODULE_CODES.map((moduleCode) => ({
                        code: { startsWith: `${moduleCode}.` },
                    })),
                },
                orderBy: { code: 'asc' },
            });

            // Nhóm permissions theo module (phần đầu của code trước dấu '.')
            const structure: Record<string, any> = {};

            for (const perm of permissions) {
                const parts = perm.code.split('.');
                if (parts.length < 2) continue; // bỏ qua nếu không đúng format
                const moduleCode = parts[0];
                if (!RBAC_MENU_MODULE_CODES.includes(moduleCode as any)) continue;
                const action = parts.slice(1).join('.'); // vì có thể có action phức như 'reset_password'

                const groupName = RBAC_MENU_LABELS[moduleCode];

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
        } catch (error) {
            throw new ApiError('Failed to fetch permissions structure', 500);
        }
    },
};

export default RoleService;
