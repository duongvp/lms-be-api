import { PrismaClient, Prisma } from '@prisma/client';
import { RoomConfigFilter, SaveRoomConfigInput } from './room-config.types';

const prisma = new PrismaClient();

const withoutLegacyStaffAssignments = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value || {};
  const config = { ...(value as Record<string, unknown>) };
  delete config._staff_assignments;
  return config;
};

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

    return {
      items: items.map((item) => ({
        ...item,
        config: withoutLegacyStaffAssignments(item.config),
      })),
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

    return item
      ? { ...item, config: withoutLegacyStaffAssignments(item.config) }
      : null;
  }

  private async upsertRoomConfigInTransaction(
    tx: Prisma.TransactionClient,
    input: SaveRoomConfigInput
  ) {
    const { code, learn_number, config, updated_by } = input;
    const numLearnNumber = Number(learn_number);

      return tx.room_config.upsert({
        where: {
          code_learn_number: {
            code,
            learn_number: numLearnNumber,
          },
        },
        create: {
          code,
          learn_number: numLearnNumber,
          config: withoutLegacyStaffAssignments(config),
          updated_by: updated_by || 'system',
          updated_at: new Date(),
        },
        update: {
          config: withoutLegacyStaffAssignments(config),
          updated_by: updated_by || 'system',
          updated_at: new Date(),
        },
      });
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
