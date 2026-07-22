import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";

export type RolePayload = {
  code: string;
  name: string;
  description?: string;
  fieldPolicy?: any; // JSON
  permissionIds?: Array<number | string | bigint>;
};

export type RoleQueryOptions = {
  skip?: number;
  take?: number;
  filter?: string;
  orderBy?: Prisma.rolesOrderByWithRelationInput;
};

// 1. Lấy danh sách có phân trang và tìm kiếm
export const getAllRoles = async (options?: RoleQueryOptions) => {
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
    prisma.roles.findMany({
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
    prisma.roles.count({ where }),
  ]);

  return { data, total, skip, take };
};

// 2. Lấy chi tiết theo id
export const getRoleById = async (id: bigint) => {
  const role = await prisma.roles.findUnique({
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

// 3. Lấy theo code
export const getRoleByCode = async (code: string) => {
  return prisma.roles.findUnique({
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

// 4. Tạo mới role với danh sách permissionIds
export const createRole = async (payload: RolePayload) => {
  const { code, name, description, fieldPolicy, permissionIds = [] } = payload;

  // Kiểm tra trùng code
  const existing = await prisma.roles.findUnique({ where: { code } });
  if (existing) {
    throw new Error(`Role with code ${code} already exists`);
  }

  // Chuẩn hóa permissionIds thành bigint[]
  const ids = permissionIds.map(id => BigInt(id));

  return prisma.roles.create({
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

// 5. Cập nhật role
export const updateRole = async (id: bigint, payload: Partial<RolePayload>) => {
  const { name, description, fieldPolicy, permissionIds } = payload;

  // Kiểm tra tồn tại
  const existing = await prisma.roles.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Role with id ${id} not found`);
  }

  // Nếu đổi code, kiểm tra trùng
  if (payload.code && payload.code !== existing.code) {
    const conflict = await prisma.roles.findUnique({
      where: { code: payload.code },
    });
    if (conflict) {
      throw new Error(`Role with code ${payload.code} already exists`);
    }
  }

  return prisma.$transaction(async (tx) => {
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

// 6. Xóa role
export const deleteRole = async (id: bigint) => {
  const existing = await prisma.roles.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Role with id ${id} not found`);
  }
  return prisma.roles.delete({ where: { id } });
};

// 7. Gán một permission cho role (riêng lẻ)
export const addPermissionToRole = async (roleId: bigint, permissionId: bigint) => {
  const role = await prisma.roles.findUnique({ where: { id: roleId } });
  if (!role) throw new Error(`Role ${roleId} not found`);
  const perm = await prisma.permissions.findUnique({ where: { id: permissionId } });
  if (!perm) throw new Error(`Permission ${permissionId} not found`);

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

// 8. Xóa một permission khỏi role (riêng lẻ)
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

// 9. Lấy danh sách user thuộc role
export const getUsersByRole = async (roleId: bigint) => {
  const role = await prisma.roles.findUnique({ where: { id: roleId } });
  if (!role) throw new Error(`Role ${roleId} not found`);
  const userRoles = await prisma.userRoles.findMany({
    where: { roleId },
    include: { user: true },
  });
  return userRoles.map(ur => ur.user);
};