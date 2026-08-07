import { PrismaClient, Prisma } from '@prisma/client';
import { RoomConfigFilter, SaveRoomConfigInput, StaffInfoInput } from './room-config.types';

const prisma = new PrismaClient();

export class RoomConfigRepository {
  async findMany(filter: RoomConfigFilter) {
    const page = filter.page && filter.page > 0 ? Number(filter.page) : 1;
    const limit = filter.limit && filter.limit > 0 ? Number(filter.limit) : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.room_configWhereInput = {};

    if (filter.search) {
      where.OR = [
        { code: { contains: filter.search } },
        { updated_by: { contains: filter.search } },
      ];
    }

    if (filter.code) {
      where.code = filter.code;
    }

    if (filter.learn_number !== undefined && filter.learn_number !== null && !isNaN(Number(filter.learn_number))) {
      where.learn_number = Number(filter.learn_number);
    }

    const [items, total] = await Promise.all([
      prisma.room_config.findMany({
        where,
        orderBy: [{ updated_at: 'desc' }, { code: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.room_config.count({ where }),
    ]);

    // Enhance items with associated teacher & assistant_teacher user info
    const itemsWithStaff = await Promise.all(
      items.map(async (item) => {
        const [teacherUser, assistantUser] = await Promise.all([
          prisma.users.findFirst({
            where: {
              code: item.code,
              learn_number: item.learn_number,
              room_id: 1,
            },
            orderBy: { id: 'asc' },
          }),
          prisma.users.findFirst({
            where: {
              code: item.code,
              learn_number: item.learn_number,
              room_id: 2,
            },
            orderBy: { id: 'asc' },
          }),
        ]);

        return {
          ...item,
          teacher: teacherUser || null,
          assistant_teacher: assistantUser || null,
        };
      })
    );

    return {
      items: itemsWithStaff,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findByKey(code: string, learn_number: number) {
    const item = await prisma.room_config.findUnique({
      where: {
        code_learn_number: {
          code,
          learn_number: Number(learn_number),
        },
      },
    });

    if (!item) return null;

    const [teacherUser, assistantUser] = await Promise.all([
      prisma.users.findFirst({
        where: {
          code,
          learn_number: Number(learn_number),
          room_id: 1,
        },
        orderBy: { id: 'asc' },
      }),
      prisma.users.findFirst({
        where: {
          code,
          learn_number: Number(learn_number),
          room_id: 2,
        },
        orderBy: { id: 'asc' },
      }),
    ]);

    return {
      ...item,
      teacher: teacherUser || null,
      assistant_teacher: assistantUser || null,
    };
  }

  async upsertRoomConfig(input: SaveRoomConfigInput) {
    const { code, learn_number, config, updated_by, teacher, assistant_teacher } = input;
    const numLearnNumber = Number(learn_number);

    return prisma.$transaction(async (tx) => {
      // 1. Upsert into room_config
      const roomConfigRecord = await tx.room_config.upsert({
        where: {
          code_learn_number: {
            code,
            learn_number: numLearnNumber,
          },
        },
        create: {
          code,
          learn_number: numLearnNumber,
          config: config || {},
          updated_by: updated_by || 'system',
          updated_at: new Date(),
        },
        update: {
          config: config || {},
          updated_by: updated_by || 'system',
          updated_at: new Date(),
        },
      });

      // Helper function to upsert user record into users table
      // class_id = code + learn_number (nối trực tiếp, ví dụ: toan-6-2027 + 14 = toan-6-202714)
      const computedClassId = `${code}${numLearnNumber}`;

      const upsertStaffUser = async (staff: StaffInfoInput, defaultRoleLabel: string) => {
        if (!staff || !staff.username) return null;

        const username = staff.username.trim();
        const studentHmid = staff.student_hmid ? String(staff.student_hmid).trim() : '';
        const name = staff.name ? staff.name.trim() : (studentHmid ? `${studentHmid} - ${defaultRoleLabel}` : username);
        const email = staff.email ? staff.email.trim() : username;
        const phone = staff.phone ? staff.phone.trim() : '';
        const islearn = staff.islearn !== undefined ? Number(staff.islearn) : 0;
        // Cả giáo viên và trợ giảng đều có room_id = 1
        const roomId = 1;
        // class_id = code + learn_number (không có ký tự phân cách thêm)
        const classId = staff.class_id ? staff.class_id.trim() : computedClassId;

        return tx.users.upsert({
          where: {
            username_code_learn_number: {
              username,
              code,
              learn_number: numLearnNumber,
            },
          },
          create: {
            username,
            student_hmid: studentHmid,
            email,
            phone,
            name,
            code,
            learn_number: numLearnNumber,
            islearn,
            room_id: roomId,
            class_id: classId,
            created_at: new Date(),
            updated_at: new Date(),
          },
          update: {
            student_hmid: studentHmid || undefined,
            name: name || undefined,
            email: email || undefined,
            phone: phone || undefined,
            islearn,
            room_id: roomId,
            class_id: classId,
            updated_at: new Date(),
          },
        });
      };

      // 2. Upsert Teacher (room_id = 1)
      const teacherRecord = teacher ? await upsertStaffUser(teacher, 'Giáo viên') : null;

      // 3. Upsert Assistant Teacher (room_id = 1)
      const assistantRecord = assistant_teacher ? await upsertStaffUser(assistant_teacher, 'Trợ giảng') : null;

      return {
        ...roomConfigRecord,
        teacher: teacherRecord,
        assistant_teacher: assistantRecord,
      };
    });
  }
}

export default new RoomConfigRepository();
