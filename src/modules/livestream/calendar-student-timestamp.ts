import type { Prisma } from '@prisma/client';

// Prisma's generated values for @default(now()) can use the application UTC
// clock. Read the database session clock explicitly so enrollment inserts match
// CURRENT_TIMESTAMP in the same database, without adding a fixed UTC offset.
export async function calendarStudentTimestamps(client: Pick<Prisma.TransactionClient, '$queryRaw'>) {
  const [clock] = await client.$queryRaw<Array<{ db_now: Date }>>`
    SELECT CURRENT_TIMESTAMP AS db_now
  `;
  if (!(clock?.db_now instanceof Date) || !Number.isFinite(clock.db_now.getTime())) {
    throw new Error('Không đọc được giờ database để ghi thời gian học viên');
  }
  return {created_at: clock.db_now, updated_at: clock.db_now};
}
