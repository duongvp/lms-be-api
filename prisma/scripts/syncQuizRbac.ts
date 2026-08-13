import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const fields = [
  ['id', 'ID', 'number'],
  ['quiz_id', 'Mã câu hỏi', 'text'],
  ['code', 'Mã lớp', 'text'],
  ['learn_number', 'Buổi học', 'number'],
  ['quiz_name', 'Nội dung câu hỏi', 'text'],
  ['quiz_type', 'Loại câu hỏi', 'number'],
  ['ans', 'Đáp án', 'json'],
  ['score_type', 'Cách tính điểm', 'number'],
  ['ans_duration', 'Thời gian trả lời (giây)', 'number'],
  ['quiz_status', 'Trạng thái', 'select'],
  ['quiz_index', 'Thứ tự', 'number'],
  ['creator', 'Người tạo', 'text'],
  ['created_at', 'Ngày tạo', 'datetime'],
  ['updated_at', 'Ngày cập nhật', 'datetime'],
] as const;

const permissions = [
  ['quiz.view', 'Xem câu hỏi'],
  ['quiz.create', 'Thêm câu hỏi'],
  ['quiz.update', 'Cập nhật câu hỏi'],
  ['quiz.delete', 'Vô hiệu hóa câu hỏi'],
  ['quiz.import', 'Import câu hỏi'],
  ['quiz.export', 'Export câu hỏi'],
] as const;

async function main() {
  const result = await prisma.$transaction(async (tx) => {
    const module = await tx.modules.upsert({
      where: { code: 'quiz' },
      update: { name: 'Quản lý câu hỏi' },
      create: { code: 'quiz', name: 'Quản lý câu hỏi' },
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
        update: { name, description: `${name} trong module Quản lý câu hỏi` },
        create: { code, name, description: `${name} trong module Quản lý câu hỏi` },
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
              quiz: { fields: { '*': { visible: true, editable: true } } },
            },
          },
        },
      });
    }

    return {
      fields: await tx.moduleFields.count({ where: { moduleId: module.id } }),
      permissions: await tx.permissions.count({ where: { code: { startsWith: 'quiz.' } } }),
      adminPermissions: adminRole
        ? await tx.rolePermissions.count({
          where: { roleId: adminRole.id, permission: { code: { startsWith: 'quiz.' } } },
        })
        : 0,
      adminGranted: Boolean(adminRole),
    };
  });

  console.log(
    `Quiz RBAC synchronized: ${result.fields} fields, ${result.permissions} permissions, ${result.adminPermissions} admin mappings, admin granted: ${result.adminGranted}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    // process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
