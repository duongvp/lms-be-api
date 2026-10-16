// Dedicated localhost MySQL only. Never load .env or call an external API.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';

const supplied = process.env.TEST_REGISTRATION_AUDIT_DATABASE_URL;
assert.ok(supplied, 'Set TEST_REGISTRATION_AUDIT_DATABASE_URL to a dedicated local test server');
const url = new URL(supplied);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port && url.port !== '3306');
assert.match(url.pathname, /^\/calendar_source_\w*test$/);
const database = `registration_audit_qa_${Date.now()}`;
const admin = new PrismaClient({datasources: {db: {url: supplied}}});
url.pathname = '/' + database;
process.env.DATABASE_URL = url.toString();
process.env.HOCMAI_LIVE_USER_API_URL = 'https://example.invalid/registrations';
process.env.HOCMAI_LIVE_USER_API_TOKEN = 'fixture-token';
const originalFetch = global.fetch;
const originalNow = Date.now;
Date.now = () => Date.parse('2026-10-15T03:00:00Z');
let db: PrismaClient | undefined;
let serviceClient: PrismaClient | undefined;
let created = false;
const checks: string[] = [];

(async () => {
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); created = true;
  db = new PrismaClient({datasources: {db: {url: url.toString()}}});
  // Fixture contains only tables used by the new feature: any attempt to touch
  // calendar queues, class assignment, stream or existing job tables must fail.
  await db.$executeRawUnsafe(`CREATE TABLE calendar (
    id INT PRIMARY KEY, \`key\` VARCHAR(100), code VARCHAR(30), learn_number INT,
    start_time DATETIME, student_synced_at DATETIME NULL
  ) ENGINE=InnoDB`);
  await db.$executeRawUnsafe(`CREATE TABLE package_lesson_mapping (
    id INT AUTO_INCREMENT PRIMARY KEY, \`key\` VARCHAR(100), package_id VARCHAR(50)
  ) ENGINE=InnoDB`);
  await db.$executeRawUnsafe(`CREATE TABLE users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, username VARCHAR(100) NOT NULL,
    student_hmid VARCHAR(50), email VARCHAR(100), name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NOT NULL, learn_number INT NOT NULL DEFAULT 0, islearn TINYINT NOT NULL DEFAULT 0,
    phone VARCHAR(20), room_id INT, class_id VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_enroll (username,code,learn_number)
  ) ENGINE=InnoDB`);
  await db.$executeRawUnsafe("INSERT INTO calendar VALUES (1,'key-1','QA',1,'2026-10-14 08:00:00',NULL),(2,'key-2','QA',2,'2026-10-15 08:00:00',NULL),(3,'key-3','ROLLBACK',1,'2026-10-15 08:00:00',NULL)");
  await db.$executeRawUnsafe("INSERT INTO package_lesson_mapping (`key`,package_id) VALUES ('key-1','9318'),('key-1','9166'),('key-2','9318'),('key-3','9318')");
  const users = Array.from({length: 1101}, (_, index) => ({
    userid: String(10000 + index), username: index === 1100 ? 'élève' : String(index).padStart(10, '0'),
    name: `Test Student ${index}`, email: '', phone: '', product_id: '9318',
  }));
  const apiRows = [...users, {...users[0], product_id: '9166'}];
  const todayRows = [{...users[0], product_id: '9318'},
    {userid: '99999', username: 'today-only-user', name: 'Today only', email: '', phone: '', product_id: '9318'}];
  const seeds = users.slice(0, 500).map(user => ({username: user.username, student_hmid: user.userid,
    name: 'Keep existing name', code: 'QA', learn_number: 1, islearn: 1, room_id: 42, class_id: 'keep-existing-class'}));
  await db.users.createMany({data: [...seeds,
    {username: 'eleve', student_hmid: '11100', name: 'Existing accent-equivalent username', code: 'QA', learn_number: 1, islearn: 1, room_id: 42, class_id: 'keep-existing-class'},
    {username: users[500].username, name: 'Other lesson must not count', code: 'QA', learn_number: 99, islearn: 1},
  ]});
  let requests = 0;
  let incomplete = false;
  let changedBetweenSnapshots = false;
  let incompleteCutoff = false;
  global.fetch = async (input, options) => {
    const request = new URL(String(input));
    assert.equal(request.origin, 'https://example.invalid');
    assert.equal((options?.headers as any).token, 'fixture-token');
    const since = request.searchParams.get('registed_at');
    assert.ok(since === '14/10/2026' || since === '15/10/2026');
    const page = Number(request.searchParams.get('page'));
    const packages = [...request.searchParams].filter(([key]) => key.startsWith('packages[')).map(([,value]) => value);
    const source = since === '15/10/2026'
      ? [...todayRows, ...(changedBetweenSnapshots ? [{...todayRows[1], userid: '99998', username: 'between-snapshots'}] : [])]
      : [...apiRows, ...todayRows];
    const filtered = source.filter(user => packages.includes(user.product_id));
    requests += 1;
    return new Response(JSON.stringify({status: 'success', total: filtered.length, per_page: '100', current_page: String(page),
      last_page: Math.ceil(filtered.length / 100), data: incomplete || (incompleteCutoff && since === '15/10/2026') ? [] : filtered.slice((page - 1) * 100, page * 100),
    }));
  };
  const audit = await import('../src/modules/livestream/calendar-registration-audit.service');
  serviceClient = (await import('../src/lib/prisma')).default;
  const finish = async (id: string, owner: number, scope: string[] | null) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const value = audit.getRegistrationAudit(id, owner, scope);
      if (!['checking', 'inserting'].includes(value.status)) return value;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('Audit job did not finish');
  };
  const calendarBefore = await db.$queryRawUnsafe('SELECT * FROM calendar ORDER BY id');
  const existingBefore = await db.users.findMany({where: {code: 'QA', learn_number: 1}, orderBy: {id: 'asc'}});
  const beforeCount = await db.users.count();
  await assert.rejects(audit.startRegistrationAudit([1], '14/10/2026', 2, []), (error: any) => error.statusCode === 403);
  assert.equal(requests, 0);
  const {jobId} = await audit.startRegistrationAudit([1], '14/10/2026', 1, ['QA']);
  const report = await finish(jobId, 1, ['QA']);
  assert.equal(report.status, 'ready');
  assert.deepEqual(report.stats, {apiRows: 1102, apiRowsSinceDate: 1104, excludedNewerRows: 2, uniqueUsers: 1101, expectedEnrollments: 1101, existingEnrollments: 501, missingEnrollments: 600});
  assert.equal(requests, 13);
  assert.ok(!report.rows.some(row => row.username === 'today-only-user'));
  assert.equal(report.rows.length, 50);
  assert.equal(audit.getRegistrationAudit(jobId, 1, ['QA'], 12).rows.length, 50);
  assert.equal(await db.users.count(), beforeCount);
  assert.deepEqual(await db.$queryRawUnsafe('SELECT * FROM calendar ORDER BY id'), calendarBefore);
  assert.throws(() => audit.getRegistrationAudit(jobId, 2, ['QA']), (error: any) => error.statusCode === 404);
  assert.throws(() => audit.applyRegistrationAudit(jobId, 1, []), (error: any) => error.statusCode === 403);
  checks.push('1104 cumulative rows minus 2 today => 1102 yesterday rows / 1101 unique enrollments; all 13 pages fetched; 501 existing and 600 missing; today-only user excluded; preview writes nothing; ownership/scope enforced');

  // Production retains class_id in its unique key. Both supported index
  // shapes must work without migrating or rewriting the existing table.
  if (process.env.TEST_REGISTRATION_AUDIT_INDEX_MODE !== '3') await db.$executeRawUnsafe('ALTER TABLE users DROP INDEX uq_users_enroll, ADD UNIQUE KEY uq_users_enroll (username,code,learn_number,class_id)');
  // Simulate a different workflow filling one missing row after the preview.
  await db.users.create({data: {username: users[500].username, name: 'Concurrent existing', code: 'QA', learn_number: 1, islearn: 1, room_id: 99, class_id: 'concurrent-class'}});
  audit.applyRegistrationAudit(jobId, 1, ['QA']);
  assert.throws(() => audit.applyRegistrationAudit(jobId, 1, ['QA']), (error: any) => error.statusCode === 409);
  const filled = await finish(jobId, 1, ['QA']);
  assert.equal(filled.status, 'completed');
  assert.deepEqual(filled.result, {inserted: 599, alreadyPresent: 1, remaining: 0});
  assert.deepEqual(await db.users.findMany({where: {id: {in: existingBefore.map(row => row.id)}}, orderBy: {id: 'asc'}}), existingBefore);
  const [newTimestamps] = await db.$queryRaw<Array<{age: number | bigint; equal_times: number | bigint}>>`
    SELECT ABS(TIMESTAMPDIFF(SECOND, created_at, CURRENT_TIMESTAMP)) AS age,
      created_at = updated_at AS equal_times
    FROM users WHERE username = ${users[501].username} AND code = 'QA' AND learn_number = 1
  `;
  assert.ok(Number(newTimestamps.age) < 30, 'Audit insertion must use the database clock too');
  assert.equal(Number(newTimestamps.equal_times), 1);
  const concurrent = await db.users.findFirstOrThrow({where: {username: users[500].username, code: 'QA', learn_number: 1}});
  assert.equal(concurrent.islearn, 1); assert.equal(concurrent.room_id, 99); assert.equal(concurrent.class_id, 'concurrent-class');
  assert.deepEqual(await db.$queryRawUnsafe('SELECT * FROM calendar ORDER BY id'), calendarBefore);
  const countAfter = await db.users.count(); audit.applyRegistrationAudit(jobId, 1, ['QA']);
  assert.equal(await db.users.count(), countAfter);
  assert.equal(await db.users.count({where: {username: 'today-only-user'}}), 0);
  checks.push('Only 599 still-missing enrollments inserted; concurrent row and every existing name/islearn/room/class preserved; repeated apply safe with existing class-aware unique key; calendar flags unchanged; no other workflow tables required');

  const stale = await audit.startRegistrationAudit([2], '14/10/2026', 3, ['QA']);
  assert.equal((await finish(stale.jobId, 3, ['QA'])).status, 'ready');
  await db.$executeRawUnsafe("UPDATE package_lesson_mapping SET package_id='9999' WHERE `key`='key-2'");
  audit.applyRegistrationAudit(stale.jobId, 3, ['QA']);
  assert.equal((await finish(stale.jobId, 3, ['QA'])).status, 'failed');
  assert.equal(await db.users.count({where: {code: 'QA', learn_number: 2}}), 0);
  checks.push('Changing a calendar/package mapping after preview blocks insertion and requires recheck');

  // A database error in batch two must also roll back batch one.
  const trigger = spawnSync('mysql', ['--no-defaults', '--protocol=TCP', '-h', url.hostname, '-P', url.port, '-u', decodeURIComponent(url.username), database], {
    input: `DELIMITER $$
CREATE TRIGGER qa_registration_fail BEFORE INSERT ON users FOR EACH ROW
      BEGIN IF NEW.code = 'ROLLBACK' AND NEW.username = '${users[900].username}' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'fixture failure'; END IF; END$$
DELIMITER ;
`,
    encoding: 'utf8', env: {...process.env, MYSQL_PWD: decodeURIComponent(url.password)},
  });
  assert.equal(trigger.status, 0, trigger.stderr);
  const rollback = await audit.startRegistrationAudit([3], '14/10/2026', 4, ['ROLLBACK']);
  assert.equal((await finish(rollback.jobId, 4, ['ROLLBACK'])).status, 'ready');
  audit.applyRegistrationAudit(rollback.jobId, 4, ['ROLLBACK']);
  assert.equal((await finish(rollback.jobId, 4, ['ROLLBACK'])).status, 'failed');
  assert.equal(await db.users.count({where: {code: 'ROLLBACK'}}), 0);
  checks.push('Injected failure in insert batch two rolls back the entire addition');

  incomplete = true;
  const partial = await audit.startRegistrationAudit([1], '14/10/2026', 5, ['QA']);
  assert.equal((await finish(partial.jobId, 5, ['QA'])).status, 'failed');
  assert.throws(() => audit.applyRegistrationAudit(partial.jobId, 5, ['QA']));
  assert.equal(await db.users.count(), countAfter);
  checks.push('Incomplete API pagination never reports success and cannot be applied');
  incomplete = false;
  changedBetweenSnapshots = true;
  const changed = await audit.startRegistrationAudit([1], '14/10/2026', 7, ['QA']);
  const changedReport = await finish(changed.jobId, 7, ['QA']);
  assert.equal(changedReport.status, 'failed');
  assert.match(changedReport.error!, /thay đổi giữa hai lần/);
  assert.throws(() => audit.applyRegistrationAudit(changed.jobId, 7, ['QA']));
  changedBetweenSnapshots = false;
  incompleteCutoff = true;
  const partialCutoff = await audit.startRegistrationAudit([1], '14/10/2026', 8, ['QA']);
  assert.equal((await finish(partialCutoff.jobId, 8, ['QA'])).status, 'failed');
  assert.throws(() => audit.applyRegistrationAudit(partialCutoff.jobId, 8, ['QA']));
  assert.equal(await db.users.count(), countAfter);
  incompleteCutoff = false;
  checks.push('A new registration between snapshots or incomplete today pagination blocks preview/apply and leaves users unchanged');
  await db.$executeRawUnsafe("UPDATE package_lesson_mapping SET package_id='9318' WHERE `key`='key-2'");
  const noIndex = await audit.startRegistrationAudit([2], '14/10/2026', 6, ['QA']);
  assert.equal((await finish(noIndex.jobId, 6, ['QA'])).status, 'ready');
  await db.$executeRawUnsafe('ALTER TABLE users DROP INDEX uq_users_enroll');
  audit.applyRegistrationAudit(noIndex.jobId, 6, ['QA']);
  const noIndexResult = await finish(noIndex.jobId, 6, ['QA']);
  assert.equal(noIndexResult.status, 'failed');
  assert.match(noIndexResult.error!, /ràng buộc duy nhất/);
  assert.equal(await db.users.count({where:{code:'QA',learn_number:2}}),0);
  checks.push('Database missing enrollment uniqueness constraint refuses insertion rather than risk duplicates');
  console.log(JSON.stringify({ok: true, checks}, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;}).finally(async () => {
  global.fetch = originalFetch;
  Date.now = originalNow;
  await serviceClient?.$disconnect(); await db?.$disconnect();
  if (created) await admin.$executeRawUnsafe(`DROP DATABASE \`${database}\``);
  await admin.$disconnect();
});
