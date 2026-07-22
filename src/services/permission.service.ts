import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

export type PermissionPayload = {
  code: string;
  name: string;
  description?: string;
};

// Tùy chọn phân trang và tìm kiếm
export type PermissionQueryOptions = {
  skip?: number;
  take?: number;
  filter?: string; // tìm theo code hoặc name
  orderBy?: Prisma.permissionsOrderByWithRelationInput;
};

// Hàm lấy danh sách có phân trang
export const getAllPermissions = async (options?: PermissionQueryOptions) => {
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
    prisma.permissions.findMany({
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
    prisma.permissions.count({ where }),
  ]);

  return { data, total, skip, take };
};

// Lấy một permission theo id, ném lỗi nếu không tìm thấy
export const getPermissionById = async (id: bigint) => {
  const permission = await prisma.permissions.findUnique({
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

// Lấy theo code
export const getPermissionByCode = async (code: string) => {
  return prisma.permissions.findUnique({
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

// Tạo mới, kiểm tra trùng code
export const createPermission = async (payload: PermissionPayload) => {
  const existing = await prisma.permissions.findUnique({
    where: { code: payload.code },
  });
  if (existing) {
    throw new Error(`Permission with code ${payload.code} already exists`);
  }
  return prisma.permissions.create({
    data: payload,
  });
};

// Cập nhật, kiểm tra tồn tại và trùng code (nếu thay đổi code)
export const updatePermission = async (
  id: bigint,
  payload: Partial<PermissionPayload>
) => {
  // Kiểm tra tồn tại
  const existing = await prisma.permissions.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Permission with id ${id} not found`);
  }

  // Nếu có thay đổi code, kiểm tra trùng
  if (payload.code && payload.code !== existing.code) {
    const conflict = await prisma.permissions.findUnique({
      where: { code: payload.code },
    });
    if (conflict) {
      throw new Error(`Permission with code ${payload.code} already exists`);
    }
  }

  return prisma.permissions.update({
    where: { id },
    data: payload,
  });
};

// Xóa, kiểm tra tồn tại (cascade sẽ xóa rolePermissions)
export const deletePermission = async (id: bigint) => {
  const existing = await prisma.permissions.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Permission with id ${id} not found`);
  }
  return prisma.permissions.delete({ where: { id } });
};

// Lấy danh sách permissions gán cho một role
export const getPermissionsByRole = async (roleId: bigint) => {
  const rolePermissions = await prisma.rolePermissions.findMany({
    where: { roleId },
    include: {
      permission: true,
    },
  });
  return rolePermissions.map(rp => rp.permission);
};

// Gán permission vào role
export const assignPermissionToRole = async (roleId: bigint, permissionId: bigint) => {
  // Kiểm tra tồn tại của role và permission không cần thiết vì FK sẽ báo lỗi, nhưng có thể check để báo lỗi rõ
  const role = await prisma.roles.findUnique({ where: { id: roleId } });
  if (!role) throw new Error(`Role ${roleId} not found`);
  const perm = await prisma.permissions.findUnique({ where: { id: permissionId } });
  if (!perm) throw new Error(`Permission ${permissionId} not found`);

  // Kiểm tra đã tồn tại
  const existing = await prisma.rolePermissions.findUnique({
    where: {
      roleId_permissionId: { roleId, permissionId },
    },
  });
  if (existing) {
    throw new Error('Permission already assigned to this role');
  }

  return prisma.rolePermissions.create({
    data: { roleId, permissionId },
    include: { permission: true },
  });
};

// Xóa permission khỏi role
export const removePermissionFromRole = async (roleId: bigint, permissionId: bigint) => {
  const record = await prisma.rolePermissions.findUnique({
    where: {
      roleId_permissionId: { roleId, permissionId },
    },
  });
  if (!record) {
    throw new Error('Permission not assigned to this role');
  }
  return prisma.rolePermissions.delete({
    where: {
      roleId_permissionId: { roleId, permissionId },
    },
  });
};