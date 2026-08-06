import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Bắt đầu seed dữ liệu...');

  // ---------- Xóa dữ liệu cũ (tùy chọn) ----------
  // Nếu muốn xóa toàn bộ dữ liệu liên quan đến RBAC
  // await prisma.rolePermissions.deleteMany();
  // await prisma.userRoles.deleteMany();
  // await prisma.permissions.deleteMany();
  // await prisma.roles.deleteMany();
  // await prisma.moduleFields.deleteMany();
  // await prisma.modules.deleteMany();
  // Không xóa users để giữ lại dữ liệu cũ nếu có, nhưng có thể xóa nếu cần
  // await prisma.users.deleteMany();

  // ---------- 1. Tạo Modules ----------
  const modulesData = [
    { code: 'users', name: 'Quản lý người dùng' },
    { code: 'calendar', name: 'Lịch học' },
    { code: 'lessons', name: 'Nội dung bài học' },
    { code: 'quiz', name: 'Quản lý câu hỏi' },
    { code: 'logs', name: 'Nhật ký truy cập' },
    { code: 'stream', name: 'Livestream' },
    { code: 'teacher', name: 'Giáo viên' },
    { code: 'teacher_profile', name: 'Giáo viên & Trợ giảng' },
  ];

  for (const mod of modulesData) {
    await prisma.modules.upsert({
      where: { code: mod.code },
      update: {},
      create: mod,
    });
  }
  console.log('✅ Đã tạo modules');

  // ---------- 2. Tạo Module Fields ----------
  const moduleFieldsData = [
    // Users
    { moduleCode: 'users', fieldCode: 'id', fieldLabel: 'ID', fieldType: 'number', sortOrder: 1 },
    { moduleCode: 'users', fieldCode: 'username', fieldLabel: 'Tên đăng nhập', fieldType: 'text', sortOrder: 2 },
    { moduleCode: 'users', fieldCode: 'name', fieldLabel: 'Họ tên', fieldType: 'text', sortOrder: 3 },
    { moduleCode: 'users', fieldCode: 'email', fieldLabel: 'Email', fieldType: 'text', sortOrder: 4 },
    { moduleCode: 'users', fieldCode: 'phone', fieldLabel: 'Số điện thoại', fieldType: 'text', sortOrder: 5 },
    { moduleCode: 'users', fieldCode: 'code', fieldLabel: 'Mã lớp', fieldType: 'text', sortOrder: 6 },
    { moduleCode: 'users', fieldCode: 'learn_number', fieldLabel: 'Buổi học', fieldType: 'number', sortOrder: 7 },
    { moduleCode: 'users', fieldCode: 'class_id', fieldLabel: 'ID lớp học', fieldType: 'text', sortOrder: 8 },
    { moduleCode: 'users', fieldCode: 'room_id', fieldLabel: 'ID phòng', fieldType: 'number', sortOrder: 9 },
    { moduleCode: 'users', fieldCode: 'islearn', fieldLabel: 'Trạng thái học', fieldType: 'number', sortOrder: 10 },
    { moduleCode: 'users', fieldCode: 'created_at', fieldLabel: 'Ngày tạo', fieldType: 'datetime', sortOrder: 11 },
    { moduleCode: 'users', fieldCode: 'updated_at', fieldLabel: 'Ngày cập nhật', fieldType: 'datetime', sortOrder: 12 },

    // Calendar
    { moduleCode: 'calendar', fieldCode: 'id', fieldLabel: 'ID', fieldType: 'number', sortOrder: 1 },
    { moduleCode: 'calendar', fieldCode: 'code', fieldLabel: 'Mã lớp', fieldType: 'text', sortOrder: 2 },
    { moduleCode: 'calendar', fieldCode: 'learn_number', fieldLabel: 'Buổi học', fieldType: 'number', sortOrder: 3 },
    { moduleCode: 'calendar', fieldCode: 'subject', fieldLabel: 'Môn học', fieldType: 'text', sortOrder: 4 },
    { moduleCode: 'calendar', fieldCode: 'start_time', fieldLabel: 'Bắt đầu', fieldType: 'datetime', sortOrder: 5 },
    { moduleCode: 'calendar', fieldCode: 'end_time', fieldLabel: 'Kết thúc', fieldType: 'datetime', sortOrder: 6 },
    { moduleCode: 'calendar', fieldCode: 'teacher', fieldLabel: 'Giáo viên', fieldType: 'text', sortOrder: 7 },
    { moduleCode: 'calendar', fieldCode: 'assistant_teacher', fieldLabel: 'Trợ giảng', fieldType: 'select', sortOrder: 8 },
    { moduleCode: 'calendar', fieldCode: 'lesson_name', fieldLabel: 'Tên bài học', fieldType: 'text', sortOrder: 9 },
    { moduleCode: 'calendar', fieldCode: 'lesson_link', fieldLabel: 'Link bài học', fieldType: 'text', sortOrder: 10 },
    { moduleCode: 'calendar', fieldCode: 'lesson_document', fieldLabel: 'Tài liệu', fieldType: 'text', sortOrder: 11 },
    { moduleCode: 'calendar', fieldCode: 'evg_stream', fieldLabel: 'Stream', fieldType: 'text', sortOrder: 12 },
    { moduleCode: 'calendar', fieldCode: 'lesson_status', fieldLabel: 'Trạng thái', fieldType: 'number', sortOrder: 13 },

    // Lessons
    { moduleCode: 'lessons', fieldCode: 'id', fieldLabel: 'ID', fieldType: 'number', sortOrder: 1 },
    { moduleCode: 'lessons', fieldCode: 'grade', fieldLabel: 'Khối', fieldType: 'select', sortOrder: 2 },
    { moduleCode: 'lessons', fieldCode: 'subject_name', fieldLabel: 'Tên môn học', fieldType: 'select', sortOrder: 3 },
    { moduleCode: 'lessons', fieldCode: 'subject_code', fieldLabel: 'Mã môn học', fieldType: 'text', sortOrder: 4 },
    { moduleCode: 'lessons', fieldCode: 'learn_number', fieldLabel: 'Số thứ tự bài', fieldType: 'number', sortOrder: 5 },
    { moduleCode: 'lessons', fieldCode: 'lesson_name', fieldLabel: 'Tên bài học', fieldType: 'text', sortOrder: 6 },
    { moduleCode: 'lessons', fieldCode: 'lesson_document', fieldLabel: 'Tài liệu bài học', fieldType: 'textarea', sortOrder: 7 },
    { moduleCode: 'lessons', fieldCode: 'evg_banner', fieldLabel: 'Banner', fieldType: 'text', sortOrder: 8 },
    { moduleCode: 'lessons', fieldCode: 'evg_stream', fieldLabel: 'EVG Stream', fieldType: 'text', sortOrder: 9 },
    { moduleCode: 'lessons', fieldCode: 'lesson_link', fieldLabel: 'Link bài học', fieldType: 'text', sortOrder: 10 },
    { moduleCode: 'lessons', fieldCode: 'lesson_baitap', fieldLabel: 'Bài tập', fieldType: 'textarea', sortOrder: 11 },
    { moduleCode: 'lessons', fieldCode: 'lesson_tomtat', fieldLabel: 'Tóm tắt', fieldType: 'textarea', sortOrder: 12 },
    { moduleCode: 'lessons', fieldCode: 'lesson_phuongphap', fieldLabel: 'Phương pháp', fieldType: 'textarea', sortOrder: 13 },
    { moduleCode: 'lessons', fieldCode: 'lesson_luuy', fieldLabel: 'Lưu ý', fieldType: 'textarea', sortOrder: 14 },
    { moduleCode: 'lessons', fieldCode: 'lesson_ketqua', fieldLabel: 'Kết quả', fieldType: 'textarea', sortOrder: 15 },
    { moduleCode: 'lessons', fieldCode: 'status', fieldLabel: 'Trạng thái', fieldType: 'number', sortOrder: 16 },
    { moduleCode: 'lessons', fieldCode: 'created_at', fieldLabel: 'Ngày tạo', fieldType: 'datetime', sortOrder: 17 },
    { moduleCode: 'lessons', fieldCode: 'updated_at', fieldLabel: 'Ngày cập nhật', fieldType: 'datetime', sortOrder: 18 },

    // Quiz
    { moduleCode: 'quiz', fieldCode: 'id', fieldLabel: 'ID', fieldType: 'number', sortOrder: 1 },
    { moduleCode: 'quiz', fieldCode: 'quiz_id', fieldLabel: 'Mã câu hỏi', fieldType: 'text', sortOrder: 2 },
    { moduleCode: 'quiz', fieldCode: 'code', fieldLabel: 'Mã lớp', fieldType: 'text', sortOrder: 3 },
    { moduleCode: 'quiz', fieldCode: 'learn_number', fieldLabel: 'Buổi học', fieldType: 'number', sortOrder: 4 },
    { moduleCode: 'quiz', fieldCode: 'quiz_name', fieldLabel: 'Nội dung câu hỏi', fieldType: 'text', sortOrder: 5 },
    { moduleCode: 'quiz', fieldCode: 'quiz_type', fieldLabel: 'Loại câu hỏi', fieldType: 'number', sortOrder: 6 },
    { moduleCode: 'quiz', fieldCode: 'ans', fieldLabel: 'Đáp án', fieldType: 'json', sortOrder: 7 },
    { moduleCode: 'quiz', fieldCode: 'score_type', fieldLabel: 'Cách tính điểm', fieldType: 'number', sortOrder: 8 },
    { moduleCode: 'quiz', fieldCode: 'ans_duration', fieldLabel: 'Thời gian trả lời (giây)', fieldType: 'number', sortOrder: 9 },
    { moduleCode: 'quiz', fieldCode: 'quiz_status', fieldLabel: 'Trạng thái', fieldType: 'select', sortOrder: 10 },
    { moduleCode: 'quiz', fieldCode: 'quiz_index', fieldLabel: 'Thứ tự', fieldType: 'number', sortOrder: 11 },
    { moduleCode: 'quiz', fieldCode: 'creator', fieldLabel: 'Người tạo', fieldType: 'text', sortOrder: 12 },
    { moduleCode: 'quiz', fieldCode: 'created_at', fieldLabel: 'Ngày tạo', fieldType: 'datetime', sortOrder: 13 },
    { moduleCode: 'quiz', fieldCode: 'updated_at', fieldLabel: 'Ngày cập nhật', fieldType: 'datetime', sortOrder: 14 },

    // Logs
    { moduleCode: 'logs', fieldCode: 'id', fieldLabel: 'ID', fieldType: 'number', sortOrder: 1 },
    { moduleCode: 'logs', fieldCode: 'username', fieldLabel: 'Tên đăng nhập', fieldType: 'text', sortOrder: 2 },
    { moduleCode: 'logs', fieldCode: 'name', fieldLabel: 'Họ tên', fieldType: 'text', sortOrder: 3 },
    { moduleCode: 'logs', fieldCode: 'code', fieldLabel: 'Mã lớp', fieldType: 'text', sortOrder: 4 },
    { moduleCode: 'logs', fieldCode: 'learn_number', fieldLabel: 'Buổi học', fieldType: 'number', sortOrder: 5 },
    { moduleCode: 'logs', fieldCode: 'learn_date', fieldLabel: 'Ngày học', fieldType: 'date', sortOrder: 6 },
    { moduleCode: 'logs', fieldCode: 'created_at', fieldLabel: 'Thời gian truy cập', fieldType: 'datetime', sortOrder: 7 },
    { moduleCode: 'logs', fieldCode: 'ip', fieldLabel: 'Địa chỉ IP', fieldType: 'text', sortOrder: 8 },
    { moduleCode: 'logs', fieldCode: 'url', fieldLabel: 'URL', fieldType: 'text', sortOrder: 9 },

    // Stream
    { moduleCode: 'stream', fieldCode: 'id', fieldLabel: 'ID', fieldType: 'number', sortOrder: 1 },
    { moduleCode: 'stream', fieldCode: 'code', fieldLabel: 'Mã lớp', fieldType: 'text', sortOrder: 2 },
    { moduleCode: 'stream', fieldCode: 'learn_number', fieldLabel: 'Buổi học', fieldType: 'number', sortOrder: 3 },
    { moduleCode: 'stream', fieldCode: 'room_id', fieldLabel: 'ID phòng', fieldType: 'number', sortOrder: 4 },
    { moduleCode: 'stream', fieldCode: 'stream_key', fieldLabel: 'Stream key', fieldType: 'text', sortOrder: 5 },
    { moduleCode: 'stream', fieldCode: 'banner_url', fieldLabel: 'Banner', fieldType: 'text', sortOrder: 6 },
    { moduleCode: 'stream', fieldCode: 'type', fieldLabel: 'Loại', fieldType: 'number', sortOrder: 7 },
    { moduleCode: 'stream', fieldCode: 'class_id', fieldLabel: 'ID lớp', fieldType: 'text', sortOrder: 8 },

    // Teacher
    { moduleCode: 'teacher', fieldCode: 'id', fieldLabel: 'ID', fieldType: 'number', sortOrder: 1 },
    { moduleCode: 'teacher', fieldCode: 'username', fieldLabel: 'Tên đăng nhập', fieldType: 'text', sortOrder: 2 },
    { moduleCode: 'teacher', fieldCode: 'display_name', fieldLabel: 'Tên hiển thị', fieldType: 'text', sortOrder: 3 },
    { moduleCode: 'teacher', fieldCode: 'teacher_type', fieldLabel: 'Loại giáo viên', fieldType: 'number', sortOrder: 4 },

    // Teacher Profile
    { moduleCode: 'teacher_profile', fieldCode: 'id', fieldLabel: 'ID', fieldType: 'number', sortOrder: 1 },
    { moduleCode: 'teacher_profile', fieldCode: 'username', fieldLabel: 'Mã nhân sự', fieldType: 'text', sortOrder: 2 },
    { moduleCode: 'teacher_profile', fieldCode: 'display_name', fieldLabel: 'Họ và tên', fieldType: 'text', sortOrder: 3 },
    { moduleCode: 'teacher_profile', fieldCode: 'teacher_type', fieldLabel: 'Loại nhân sự', fieldType: 'select', sortOrder: 4 },
    { moduleCode: 'teacher_profile', fieldCode: 'status', fieldLabel: 'Trạng thái', fieldType: 'select', sortOrder: 5 },
    { moduleCode: 'teacher_profile', fieldCode: 'created_at', fieldLabel: 'Ngày tạo', fieldType: 'datetime', sortOrder: 6 },
    { moduleCode: 'teacher_profile', fieldCode: 'updated_at', fieldLabel: 'Ngày cập nhật', fieldType: 'datetime', sortOrder: 7 },
  ];

  // Lấy danh sách module đã tạo
  const modules = await prisma.modules.findMany();
  const moduleMap = Object.fromEntries(modules.map(m => [m.code, m.id]));

  for (const field of moduleFieldsData) {
    const moduleId = moduleMap[field.moduleCode];
    if (!moduleId) continue;
    await prisma.moduleFields.upsert({
      where: {
        moduleId_fieldCode: { moduleId, fieldCode: field.fieldCode },
      },
      update: {
        fieldLabel: field.fieldLabel,
        fieldType: field.fieldType,
        sortOrder: field.sortOrder,
      },
      create: {
        moduleId,
        fieldCode: field.fieldCode,
        fieldLabel: field.fieldLabel,
        fieldType: field.fieldType,
        sortOrder: field.sortOrder,
      },
    });
  }
  console.log('✅ Đã tạo module fields');

  // ---------- 3. Tạo Permissions ----------
  // Danh sách action: view, create, update, delete, import, export
  const actions = ['view', 'create', 'update', 'delete', 'import', 'export'];
  // Có thể thêm action đặc thù: approve, cancel, start, end, ...
  const permissionsData = [];

  // Với mỗi module, tạo các permission cơ bản
  const moduleCodes = modulesData.map(m => m.code);
  for (const mod of moduleCodes) {
    for (const action of actions) {
      const code = `${mod}.${action}`;
      const name = `${action.charAt(0).toUpperCase() + action.slice(1)} ${mod}`;
      permissionsData.push({
        code,
        name: name,
        description: `Cho phép ${action} dữ liệu module ${mod}`,
      });
    }
  }

  // Thêm một vài permission đặc thù (nếu cần)
  // Ví dụ: duyệt, hủy, bắt đầu, kết thúc...
  permissionsData.push(
    { code: 'calendar.approve', name: 'Duyệt lịch', description: 'Duyệt lịch học' },
    { code: 'quiz.grade', name: 'Chấm điểm', description: 'Chấm điểm bài kiểm tra' },
    { code: 'users.reset_password', name: 'Đặt lại mật khẩu', description: 'Cho phép đặt lại mật khẩu người dùng' },
    { code: 'teacher_profile.status', name: 'Thay đổi trạng thái nhân sự', description: 'Kích hoạt hoặc vô hiệu hóa nhân sự giảng dạy' },
    { code: 'calendar.teacher.view', name: 'Xem phân công giáo viên', description: 'Xem giáo viên và trợ giảng được phân công' },
    { code: 'calendar.teacher.assign', name: 'Gán giáo viên và trợ giảng', description: 'Phân công khi tạo lịch' },
    { code: 'calendar.teacher.update', name: 'Cập nhật phân công', description: 'Thay đổi phân công trong lịch' },
    { code: 'calendar.teacher.remove', name: 'Gỡ phân công', description: 'Gỡ giáo viên và trợ giảng khỏi lịch' },
  );

  for (const perm of permissionsData) {
    await prisma.permissions.upsert({
      where: { code: perm.code },
      update: {},
      create: perm,
    });
  }
  console.log('✅ Đã tạo permissions');

  // Lấy danh sách permission để gán cho role
  const allPermissions = await prisma.permissions.findMany();
  const permMap = Object.fromEntries(allPermissions.map(p => [p.code, p.id]));

  // ---------- 4. Tạo Roles ----------
  // Admin: toàn quyền
  // Manager: quản lý, có thể xem và sửa hầu hết, nhưng không xóa và một số hạn chế
  // Teacher: giáo viên, xem/sửa calendar, quiz, stream, không sửa user
  // Student: chỉ xem một số module

  const rolesData = [
    {
      code: 'admin',
      name: 'Quản trị viên',
      description: 'Toàn quyền trên hệ thống',
      fieldPolicy: {
        modules: {
          users: { fields: { '*': { visible: true, editable: true } } },
          calendar: { fields: { '*': { visible: true, editable: true } } },
          lessons: { fields: { '*': { visible: true, editable: true } } },
          quiz: { fields: { '*': { visible: true, editable: true } } },
          logs: { fields: { '*': { visible: true, editable: true } } },
          stream: { fields: { '*': { visible: true, editable: true } } },
          teacher: { fields: { '*': { visible: true, editable: true } } },
          teacher_profile: { fields: { '*': { visible: true, editable: true } } },
        }
      },
      permissions: allPermissions.map(p => p.id), // tất cả
    },
    {
      code: 'manager',
      name: 'Quản lý',
      description: 'Quản lý, có quyền xem và sửa hầu hết, không xóa',
      fieldPolicy: {
        modules: {
          users: { fields: { '*': { visible: true, editable: true } } },
          calendar: { fields: { '*': { visible: true, editable: true } } },
          lessons: { fields: { '*': { visible: true, editable: true } } },
          quiz: { fields: { '*': { visible: true, editable: true } } },
          logs: { fields: { '*': { visible: true, editable: false } } }, // chỉ xem log, không sửa
          stream: { fields: { '*': { visible: true, editable: true } } },
          teacher: { fields: { '*': { visible: true, editable: true } } },
          teacher_profile: { fields: { '*': { visible: true, editable: true } } },
        }
      },
      permissions: allPermissions
        .filter(p => (
          (
            !p.code.includes('.delete')
            && !p.code.includes('.import')
            && !p.code.includes('.export')
          )
          || ['teacher_profile.import', 'teacher_profile.export'].includes(p.code)
        ))
        .map(p => p.id),
    },
    {
      code: 'teacher',
      name: 'Giáo viên',
      description: 'Giáo viên, quản lý lịch, quiz, stream',
      fieldPolicy: {
        modules: {
          users: { fields: { '*': { visible: false, editable: false } } }, // không xem user
          calendar: { fields: { '*': { visible: true, editable: true } } },
          lessons: { fields: { '*': { visible: true, editable: false } } },
          quiz: { fields: { '*': { visible: true, editable: true } } },
          logs: { fields: { '*': { visible: false, editable: false } } },
          stream: { fields: { '*': { visible: true, editable: true } } },
          teacher: { fields: { '*': { visible: true, editable: false } } }, // chỉ xem thông tin giáo viên
          teacher_profile: { fields: { '*': { visible: true, editable: false } } },
        }
      },
      permissions: allPermissions
        .filter(p =>
          p.code.startsWith('calendar.') ||
          p.code === 'lessons.view' ||
          p.code.startsWith('quiz.') ||
          p.code.startsWith('stream.') ||
          p.code === 'teacher.view' ||
          p.code === 'teacher_profile.view' ||
          p.code === 'calendar.teacher.view'
        )
        .map(p => p.id),
    },
    {
      code: 'student',
      name: 'Học viên',
      description: 'Học viên, chỉ xem thông tin cơ bản',
      fieldPolicy: {
        modules: {
          users: { fields: { '*': { visible: false, editable: false } } },
          calendar: {
            fields: {
              code: { visible: true, editable: false },
              learn_number: { visible: true, editable: false },
              subject: { visible: true, editable: false },
              start_time: { visible: true, editable: false },
              end_time: { visible: true, editable: false },
              teacher: { visible: true, editable: false },
              assistant_teacher: { visible: true, editable: false },
              lesson_name: { visible: true, editable: false },
              lesson_link: { visible: true, editable: false },
              // các trường khác ẩn
            }
          },
          lessons: {
            fields: {
              grade: { visible: true, editable: false },
              subject_name: { visible: true, editable: false },
              learn_number: { visible: true, editable: false },
              lesson_name: { visible: true, editable: false },
            }
          },
          quiz: {
            fields: {
              quiz_name: { visible: true, editable: false },
              quiz_type: { visible: true, editable: false },
              ans_duration: { visible: true, editable: false },
            }
          },
          logs: { fields: { '*': { visible: false, editable: false } } },
          stream: {
            fields: {
              code: { visible: true, editable: false },
              learn_number: { visible: true, editable: false },
              banner_url: { visible: true, editable: false },
              stream_key: { visible: false, editable: false },
            }
          },
          teacher: { fields: { '*': { visible: false, editable: false } } },
          teacher_profile: { fields: { '*': { visible: true, editable: false } } },
        }
      },
      permissions: allPermissions
        .filter(p =>
          p.code === 'calendar.view' ||
          p.code === 'lessons.view' ||
          p.code === 'quiz.view' ||
          p.code === 'stream.view' ||
          p.code === 'teacher_profile.view' ||
          p.code === 'calendar.teacher.view'
        )
        .map(p => p.id),
    },
  ];

  for (const roleData of rolesData) {
    const { permissions: permIds, ...rest } = roleData;
    const role = await prisma.roles.upsert({
      where: { code: rest.code },
      update: {
        name: rest.name,
        description: rest.description,
        fieldPolicy: rest.fieldPolicy,
        isActive: true,
      },
      create: {
        code: rest.code,
        name: rest.name,
        description: rest.description,
        fieldPolicy: rest.fieldPolicy,
        isActive: true,
      },
    });

    // Gán permissions cho role
    // Xóa các role_permissions cũ nếu có
    await prisma.rolePermissions.deleteMany({ where: { roleId: role.id } });
    for (const permId of permIds) {
      await prisma.rolePermissions.create({
        data: {
          roleId: role.id,
          permissionId: permId,
        },
      });
    }
    console.log(`✅ Đã tạo role ${rest.code}`);
  }

  // ---------- 5. Tạo Users mẫu và gán role ----------
  // Tạo một vài user nếu chưa có
  const usersData = [
    { username: 'admin', name: 'Admin System', code: 'ADMIN', learn_number: 0, class_id: null, room_id: null, email: 'admin@lms.com', phone: '0987654321' },
    { username: 'teacher1', name: 'Nguyễn Văn A', code: 'TCH001', learn_number: 0, class_id: 'CL001', room_id: 1, email: 'teacher1@lms.com', phone: '0912345678' },
    { username: 'student1', name: 'Lê Thị B', code: 'STU001', learn_number: 1, class_id: 'CL001', room_id: 1, email: 'student1@lms.com', phone: '0909123456' },
    { username: 'student2', name: 'Trần Văn C', code: 'STU001', learn_number: 2, class_id: 'CL001', room_id: 1, email: 'student2@lms.com', phone: '0909345678' },
  ];

  for (const userData of usersData) {
    // Kiểm tra xem user đã tồn tại chưa (dựa trên username)
    let user = await prisma.users.findFirst({
      where: { username: userData.username },
    });
    if (!user) {
      user = await prisma.users.create({
        data: {
          username: userData.username,
          name: userData.name,
          code: userData.code,
          learn_number: userData.learn_number,
          class_id: userData.class_id,
          room_id: userData.room_id,
          email: userData.email,
          phone: userData.phone,
          islearn: 1,
        },
      });
      console.log(`✅ Đã tạo user ${userData.username}`);
    } else {
      console.log(`ℹ️ User ${userData.username} đã tồn tại, bỏ qua`);
    }
  }

  // Gán role cho từng user
  // Lấy roles đã tạo
  const roles = await prisma.roles.findMany();
  const roleMap = Object.fromEntries(roles.map(r => [r.code, r.id]));

  // Danh sách gán user-role
  const userRoleMappings = [
    { username: 'admin', roleCode: 'admin' },
    { username: 'teacher1', roleCode: 'teacher' },
    { username: 'student1', roleCode: 'student' },
    { username: 'student2', roleCode: 'student' },
  ];

  for (const mapping of userRoleMappings) {
    const user = await prisma.users.findFirst({ where: { username: mapping.username } });
    const roleId = roleMap[mapping.roleCode];
    if (!user || !roleId) continue;

    await prisma.userRoles.upsert({
      where: {
        userId_roleId: { userId: user.id, roleId },
      },
      update: {},
      create: {
        userId: user.id,
        roleId,
      },
    });
    console.log(`✅ Gán role ${mapping.roleCode} cho user ${mapping.username}`);
  }

  // ---------- 6. Seed package_lesson_mapping ----------
  // Removed package_lesson_mapping seeding as per user request to avoid affecting existing data.

  console.log('🎉 Seed dữ liệu hoàn tất!');
}

main()
  .catch((e) => {
    console.error('❌ Lỗi seed:', e);
    // process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
