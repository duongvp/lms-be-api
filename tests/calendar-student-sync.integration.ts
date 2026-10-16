// Dedicated localhost MySQL only. No .env and no external API requests.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const supplied = process.env.TEST_CALENDAR_SOURCE_DATABASE_URL;
assert.ok(supplied, 'Set TEST_CALENDAR_SOURCE_DATABASE_URL to a dedicated localhost MySQL');
const url = new URL(supplied);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port && url.port !== '3306');
assert.match(url.pathname, /^\/calendar_source_\w*test$/);
const database = `student_sync_qa_${Date.now()}`;
const admin = new PrismaClient({datasources: {db: {url: supplied}}});
url.pathname = '/' + database;
process.env.DATABASE_URL = url.toString();
process.env.HOCMAI_LIVE_USER_API_URL = 'https://example.invalid/users';
process.env.HOCMAI_LIVE_USER_API_TOKEN = 'fixture';
const originalFetch = global.fetch;
let db: PrismaClient | undefined;
let serviceClient: PrismaClient | undefined;
let created = false;

(async () => {
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  db = new PrismaClient({datasources: {db: {url: url.toString()}}});
  await db.$executeRawUnsafe('CREATE TABLE calendar (id INT PRIMARY KEY, `key` VARCHAR(100),code VARCHAR(50),learn_number INT,start_time DATETIME)');
  await db.$executeRawUnsafe('CREATE TABLE package_lesson_mapping (id INT AUTO_INCREMENT PRIMARY KEY, `key` VARCHAR(100),package_id VARCHAR(50))');
  await db.$executeRawUnsafe(`CREATE TABLE users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) NOT NULL,
    student_hmid VARCHAR(50), email VARCHAR(100), name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NOT NULL, learn_number INT NOT NULL, islearn TINYINT NOT NULL,
    phone VARCHAR(20), room_id INT, class_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_enroll(username,code,learn_number,class_id),
    UNIQUE KEY uq_users_learning(student_hmid,code,learn_number,class_id)
  ) ENGINE=InnoDB`);
  await db.$executeRawUnsafe("INSERT INTO calendar VALUES (1,'key-1','QA',1,'2026-10-14 20:00:00')");
  await db.$executeRawUnsafe("INSERT INTO package_lesson_mapping (`key`,package_id) VALUES ('key-1','9318')");
  const rows = Array.from({length: 1104}, (_, index) => ({userid: String(index + 1), username: String(index).padStart(10, '0'), name: 'Fixture', product_id: '9318'}));
  await db.users.createMany({data: rows.slice(0, 1050).map(user => ({username: user.username, student_hmid: user.userid,
    name: 'Preserve name', code: 'QA', learn_number: 1, islearn: 1, room_id: 42, class_id: 'preserve-class'}))});
  const before = await db.users.findMany({orderBy: {id: 'asc'}});
  let requests = 0;
  global.fetch = async input => {
    const request = new URL(String(input));
    assert.equal(request.origin, 'https://example.invalid');
    assert.equal(request.searchParams.get('registed_at'), '14/10/2026');
    const page = Number(request.searchParams.get('page'));
    requests += 1;
    return new Response(JSON.stringify({status: 'success', total: '1104', per_page: '100', current_page: String(page), last_page: 12,
      data: rows.slice((page - 1) * 100, page * 100)}));
  };
  const service = await import('../src/modules/livestream/calendar-student-sync.service');
  serviceClient = (await import('../src/lib/prisma')).default;
  const result = await service.syncCalendarStudents([1], '14/10/2026');
  assert.equal(requests, 12);
  assert.equal(result.inserted, 54);
  assert.equal(result.skipped, 1050);
  assert.equal(result.failed, 0);
  assert.equal(await db.users.count(), 1104);
  assert.deepEqual(await db.users.findMany({where: {id: {in: before.map(row => row.id)}}, orderBy: {id: 'asc'}}), before);
  const added = await db.users.findFirstOrThrow({where: {username: rows[1103].username}});
  assert.equal(added.islearn, 0);
  assert.equal(added.room_id, 1);
  const [timestampCheck] = await db.$queryRaw<Array<{timezone: string; age: number | bigint; same_clock: number | bigint}>>`
    SELECT @@session.time_zone AS timezone,
      ABS(TIMESTAMPDIFF(SECOND, created_at, CURRENT_TIMESTAMP)) AS age,
      created_at = updated_at AS same_clock
    FROM users WHERE id = ${added.id}
  `;
  assert.equal(timestampCheck.timezone, '+07:00', 'Run this regression with a dedicated MySQL configured for UTC+7');
  assert.ok(Number(timestampCheck.age) < 30, 'created_at must match database time, not be seven hours behind');
  assert.equal(Number(timestampCheck.same_clock), 1);
  assert.equal((await service.syncCalendarStudents([1], '14/10/2026')).inserted, 0);
  console.log('PASS: 1104 registrations / 12 pages; 1050 existing preserved, exactly 54 missing inserted; repeated sync safe; both timestamps match UTC+7 database clock');

  // Simulate an existing HOCMAI id with a different username. INSERT IGNORE
  // rejects the second unique key although username enrollment is missing.
  const missing = rows[1103];
  await db.users.updateMany({where: {username: missing.username}, data: {username: 'existing-other-username'}});
  const blocked = await service.syncCalendarStudents([1], '14/10/2026');
  assert.equal(blocked.inserted, 0);
  assert.equal(blocked.skipped, 1103);
  assert.equal(blocked.failed, 1);
  assert.equal(await db.users.count({where: {username: missing.username}}), 0);
  console.log('PASS: conflict on HOCMAI unique key reported as failure, never counted as already enrolled; old row unchanged');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  global.fetch = originalFetch;
  await serviceClient?.$disconnect();
  await db?.$disconnect();
  if (created) await admin.$executeRawUnsafe(`DROP DATABASE \`${database}\``);
  await admin.$disconnect();
});
