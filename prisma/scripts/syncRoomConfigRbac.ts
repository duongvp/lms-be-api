import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const fields = [
  ['code', 'Mã môn học', 'text'],
  ['learn_number', 'Số buổi học', 'number'],
  ['config', 'Nội dung cấu hình phòng', 'json'],
  ['teacher', 'Giáo viên phụ trách', 'text'],
  ['assistant_teacher', 'Trợ giảng phụ trách', 'text'],
  ['updated_by', 'Người cập nhật', 'text'],
  ['updated_at', 'Thời gian cập nhật', 'datetime'],
] as const;

const permissions = [
  ['room_config.view', 'Xem cấu hình phòng học'],
  ['room_config.create', 'Thêm mới cấu hình phòng học'],
  ['room_config.update', 'Cập nhật cấu hình phòng học'],
  ['room_config.delete', 'Xóa cấu hình phòng học'],
  ['room_config.import', 'Import cấu hình phòng học'],
] as const;

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const module = await tx.modules.upsert({
      where: { code: 'room_config' },
      update: { name: 'Cấu hình phòng học' },
      create: { code: 'room_config', name: 'Cấu hình phòng học' },
    });

    for (let index = 0; index < fields.length; index += 1) {
      const [fieldCode, fieldLabel, fieldType] = fields[index];
      await tx.moduleFields.upsert({
        where: { moduleId_fieldCode: { moduleId: module.id, fieldCode } },
        update: { fieldLabel, fieldType, sortOrder: index + 1 },
        create: { moduleId: module.id, fieldCode, fieldLabel, fieldType, sortOrder: index + 1 },
      });
    }

    const permissionIds: bigint[] = [];
    for (const [code, name] of permissions) {
      const permission = await tx.permissions.upsert({
        where: { code },
        update: { name, description: `${name} trong module Cấu hình phòng học` },
        create: { code, name, description: `${name} trong module Cấu hình phòng học` },
      });
      permissionIds.push(permission.id);
    }

    const adminRole = await tx.roles.findUnique({ where: { code: 'admin' } });
    if (adminRole) {
      await tx.rolePermissions.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: adminRole.id, permissionId })),
        skipDuplicates: true,
      });

      const currentPolicy = adminRole.fieldPolicy && typeof adminRole.fieldPolicy === 'object'
        ? adminRole.fieldPolicy as Record<string, any>
        : {};
      await tx.roles.update({
        where: { id: adminRole.id },
        data: {
          fieldPolicy: {
            ...currentPolicy,
            modules: {
              ...(currentPolicy.modules || {}),
              room_config: { fields: { '*': { visible: true, editable: true } } },
            },
          },
        },
      });
    }

    return {
      fields: await tx.moduleFields.count({ where: { moduleId: module.id } }),
      permissions: await tx.permissions.count({ where: { code: { startsWith: 'room_config.' } } }),
      adminPermissions: adminRole
        ? await tx.rolePermissions.count({
          where: { roleId: adminRole.id, permission: { code: { startsWith: 'room_config.' } } },
        })
        : 0,
      adminGranted: Boolean(adminRole),
    };
  });

  console.log(
    `RoomConfig RBAC synchronized: ${result.fields} fields, ${result.permissions} permissions, ${result.adminPermissions} admin mappings, admin granted: ${result.adminGranted}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    // process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
