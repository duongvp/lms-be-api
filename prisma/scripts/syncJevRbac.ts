import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { JEV_PERMISSIONS } from '../../src/modules/jev/jev.permissions';
const prisma = new PrismaClient();
async function main() {
  await prisma.$transaction(async tx => {
    await tx.modules.upsert({ where: { code: 'jev' }, update: { name: 'Kiểm duyệt JEV' }, create: { code: 'jev', name: 'Kiểm duyệt JEV' } });
    const admin = await tx.roles.findUnique({ where: { code: 'admin' } });
    for (const [code, name] of JEV_PERMISSIONS) {
      const permission = await tx.permissions.upsert({ where: { code }, update: { name }, create: { code, name, description: 'Quản trị JEV toàn hệ thống; yêu cầu phạm vi ALL' } });
      if (admin) await tx.rolePermissions.upsert({ where: { roleId_permissionId: { roleId: admin.id, permissionId: permission.id } }, update: {}, create: { roleId: admin.id, permissionId: permission.id } });
    }
  });
  console.log('Đã đồng bộ quyền quản trị L1/JEV; không thay đổi policy hoặc mode Chat.');
}
main().catch(() => { console.error('Không thể đồng bộ quyền JEV; kiểm tra kết nối DB và schema RBAC.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
