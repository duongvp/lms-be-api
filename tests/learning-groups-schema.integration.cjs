// Explicit local URL only. Creates/drops its own disposable database, never the
// database named in the supplied URL, and never loads .env itself.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');

const supplied = process.env.TEST_LEARNING_GROUPS_DATABASE_URL;
assert.ok(supplied, 'Set TEST_LEARNING_GROUPS_DATABASE_URL explicitly');
const url = new URL(supplied);
assert.equal(url.protocol, 'mysql:');
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Local server only');
const database = `lms_group_schema_test_${randomBytes(6).toString('hex')}`;
const root = path.resolve(__dirname, '..');
let created = false;
let passed = 0;
const execute = (sql, useDatabase = true) => spawnSync('mysql', [
  '--no-defaults', '--protocol=TCP', '-h', url.hostname, '-P', url.port || '3306',
  '-u', decodeURIComponent(url.username), '--default-character-set=utf8mb4',
  '--batch', '--raw', '--skip-column-names', ...(useDatabase ? [database] : []),
], {
  input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) },
});
const sql = (statement, useDatabase = true) => {
  const result = execute(statement, useDatabase);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const rejects = statement => {
  const result = execute(statement);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0, 'Expected constraint rejection');
  assert.match(result.stderr, /ERROR (1062|1451|1452|3819|1406)/);
  passed++;
};

try {
  sql(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`, false);
  created = true;
  sql(`
    CREATE TABLE calendar (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(30) NOT NULL, learn_number INT NOT NULL, session_id BIGINT NULL,
      lesson_count INT NULL, start_time TIMESTAMP NOT NULL, end_time TIMESTAMP NOT NULL,
      \`key\` VARCHAR(100) NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    CREATE TABLE users (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(100) NOT NULL, student_hmid VARCHAR(50) NULL,
      name VARCHAR(150) NOT NULL, code VARCHAR(50) NOT NULL,
      learn_number INT NOT NULL, class_id VARCHAR(100) NULL, room_id INT NULL,
      UNIQUE KEY uq_users_enroll (username,code,learn_number,class_id),
      UNIQUE KEY uq_users_learning (student_hmid,code,learn_number,class_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    CREATE TABLE package_lesson_mapping (\`key\` VARCHAR(100),lesson_id VARCHAR(50));
    INSERT INTO calendar VALUES (1,'QA_LIVE',1,1,0,'2030-12-01 12:00:00','2030-12-01 13:00:00','tc_3031_QA_LIVE_1');
    INSERT INTO users VALUES (1,'legacy','123','Legacy student','QA_LIVE',1,'legacy-room',1);
    INSERT INTO package_lesson_mapping VALUES ('tc_3031_QA_LIVE_1','7001');
  `);
  const before = sql('SELECT * FROM calendar; SELECT * FROM users; SELECT * FROM package_lesson_mapping;');
  sql(readFileSync(path.join(root, 'prisma/migrations/20261120160000_add_learning_groups_foundation/migration.sql'), 'utf8'));
  sql(readFileSync(path.join(root, 'prisma/migrations/20261120170000_add_group_room_config/migration.sql'), 'utf8'));
  assert.equal(sql('SELECT group_room_config FROM calendar WHERE id=1'), 'NULL'); passed++;
  const after = sql(`
    SELECT id,code,learn_number,session_id,lesson_count,start_time,end_time,\`key\` FROM calendar;
    SELECT id,username,student_hmid,name,code,learn_number,class_id,room_id FROM users;
    SELECT * FROM package_lesson_mapping;
  `);
  assert.equal(after, before); passed++;
  assert.equal(sql('SELECT group_id FROM calendar WHERE id=1; SELECT calendar_id FROM users WHERE id=1;'), 'NULL\nNULL'); passed++;
  assert.equal(sql("SELECT teaching_model,default_capacity,visibility_policy,visibility_days FROM program_settings WHERE code='QA_LIVE'"), 'large_class\tNULL\tNULL\tNULL'); passed++;
  assert.equal(sql("SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='users' AND INDEX_NAME IN ('uq_users_enroll','uq_users_learning')"), '2'); passed++;

  sql(`
    INSERT INTO program_settings (code,teaching_model,default_capacity) VALUES ('QA_SMALL','small_group',10),('QA_OTHER','small_group',5);
    INSERT INTO learning_groups (id,code,group_code,name,capacity) VALUES
      (101,'QA_SMALL','A','Group A',10),(102,'QA_SMALL','B','Group B',10),(201,'QA_OTHER','A','Other A',5);
  `);
  rejects("INSERT INTO learning_groups (code,group_code,name) VALUES ('QA_SMALL','A','Duplicate')");
  rejects("INSERT INTO learning_groups (code,group_code,name) VALUES ('QA_SMALL','lower case','Invalid')");
  rejects("INSERT INTO learning_groups (code,group_code,name) VALUES ('QA_SMALL','lower','Invalid')");
  rejects("INSERT INTO learning_groups (code,group_code,name,capacity) VALUES ('QA_SMALL','ZERO','Invalid',0)");
  rejects("INSERT INTO learning_groups (code,group_code,name) VALUES ('UNKNOWN','A','Invalid')");
  rejects("INSERT INTO program_settings (code,default_capacity) VALUES ('INVALID',-1)");
  rejects("UPDATE program_settings SET visibility_days=0 WHERE code='QA_SMALL'");

  sql(`
    INSERT INTO calendar (id,code,learn_number,session_id,lesson_count,start_time,end_time,\`key\`,group_id) VALUES
      (2,'QA_SMALL',1,1,0,'2030-12-01 12:00:00','2030-12-01 13:00:00','tc_3031_QA_SMALL_1_G101',101),
      (3,'QA_SMALL',1,1,0,'2030-12-04 12:00:00','2030-12-04 13:00:00','tc_3031_QA_SMALL_1_G102',102);
  `); passed++;
  rejects("UPDATE calendar SET group_id=201 WHERE id=2");
  rejects("UPDATE calendar SET group_id=9999 WHERE id=2");
  sql(`
    INSERT INTO users (username,name,code,learn_number,class_id,room_id,calendar_id) VALUES
      ('shared','Student','QA_SMALL',1,'room-A',1,2),
      ('shared','Student','QA_SMALL',1,'room-B',1,3);
  `); passed++;
  rejects("INSERT INTO users (username,name,code,learn_number,class_id,calendar_id) VALUES ('shared','Student','QA_SMALL',1,'different-room',2)");
  rejects("INSERT INTO users (username,name,code,learn_number,class_id,calendar_id) VALUES ('wrong','Student','QA_OTHER',1,'room',2)");
  rejects("INSERT INTO users (username,name,code,learn_number,class_id,calendar_id) VALUES ('wrong','Student','QA_SMALL',2,'room',2)");
  rejects('DELETE FROM calendar WHERE id=2');
  rejects('DELETE FROM learning_groups WHERE id=101');
  rejects("DELETE FROM program_settings WHERE code='QA_SMALL'");
  // Legacy inserts without settings, group, or calendar binding still work.
  sql("INSERT INTO calendar (code,learn_number,start_time,end_time,`key`) VALUES ('FUTURE_LIVE',1,'2030-12-05 12:00:00','2030-12-05 13:00:00','legacy-format');"); passed++;
  console.log(`Passed ${passed} database integration checks; legacy keys/mappings preserved.`);
} finally {
  if (created) sql(`DROP DATABASE \`${database}\``, false);
}
