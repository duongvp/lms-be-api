import { PrismaClient, Prisma } from '@prisma/client';
import { RoomConfigFilter, SaveRoomConfigInput, StaffInfoInput } from './room-config.types';

const prisma = new PrismaClient();

export class RoomConfigRepository {
  async findMany(filter: RoomConfigFilter, allowedPrograms: string[] | null = null) {
    const page = filter.page && filter.page > 0 ? Number(filter.page) : 1;
    const limit = filter.limit && filter.limit > 0 ? Number(filter.limit) : 20;
    const skip = (page - 1) * limit;

    const where: Prisma.room_configWhereInput = allowedPrograms === null
      ? {}
      : { code: { in: allowedPrograms } };

    if (filter.search) {
      where.OR = [
        { code: { contains: filter.search } },
        { updated_by: { contains: filter.search } },
      ];
    }

    if (filter.code) {
      where.code = allowedPrograms === null
        ? filter.code
        : (allowedPrograms.includes(filter.code) ? filter.code : { in: [] });
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

  private async upsertRoomConfigInTransaction(
    tx: Prisma.TransactionClient,
    input: SaveRoomConfigInput
  ) {
    const { code, learn_number, config, updated_by, teacher, assistant_teacher } = input;
    const numLearnNumber = Number(learn_number);

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

      const upsertStaffUser = async (
        staff: StaffInfoInput,
        defaultRoleLabel: string,
        roomId: number
      ) => {
        if (!staff || !staff.username) return null;

        const username = staff.username.trim();
        const studentHmid = staff.student_hmid ? String(staff.student_hmid).trim() : '';
        const name = staff.name ? staff.name.trim() : (studentHmid ? `${studentHmid} - ${defaultRoleLabel}` : username);
        const email = staff.email ? staff.email.trim() : username;
        const phone = staff.phone ? staff.phone.trim() : '';
        const islearn = staff.islearn !== undefined ? Number(staff.islearn) : 0;
        // class_id = code + learn_number (không có ký tự phân cách thêm)
        const classId = staff.class_id ? staff.class_id.trim() : computedClassId;

        // HMID trống không phải là một định danh. Lưu NULL để MySQL cho phép
        // nhiều nhân sự chưa có HMID trong cùng lớp/bài, thay vì dùng chuỗi rỗng.
        if (studentHmid) {
          const existingLearningUser = await tx.users.findFirst({
            where: {
              student_hmid: studentHmid,
              code,
              learn_number: numLearnNumber,
              class_id: classId,
            },
          });
          if (existingLearningUser && existingLearningUser.username !== username) {
            throw new Error(
              `HMID ${studentHmid} đã thuộc nhân sự ${existingLearningUser.username} ở bài này`
            );
          }
        }

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
            student_hmid: studentHmid || null,
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
      const teacherRecord = teacher ? await upsertStaffUser(teacher, 'Giáo viên', 1) : null;

      // 3. Upsert Assistant Teacher (room_id = 2)
      const assistantRecord = assistant_teacher
        ? await upsertStaffUser(assistant_teacher, 'Trợ giảng', 2)
        : null;

      return {
        ...roomConfigRecord,
        teacher: teacherRecord,
        assistant_teacher: assistantRecord,
      };
  }

  async upsertRoomConfig(input: SaveRoomConfigInput) {
    return prisma.$transaction((tx) => this.upsertRoomConfigInTransaction(tx, input));
  }

  async bulkUpsertRoomConfigs(inputs: SaveRoomConfigInput[]) {
    return prisma.$transaction(async (tx) => {
      const results = [];
      for (const input of inputs) {
        results.push(await this.upsertRoomConfigInTransaction(tx, input));
      }
      return results;
    });
  }
}

export default new RoomConfigRepository();
