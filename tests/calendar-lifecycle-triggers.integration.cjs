// Use a disposable --skip-networking MySQL instance under /tmp only.
// TEST_CALENDAR_TRIGGER_SOCKET=/tmp/lms-lifecycle-mysql.XXXXXX/mysql.sock node tests/calendar-lifecycle-triggers.integration.cjs
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const socket = process.env.TEST_CALENDAR_TRIGGER_SOCKET || '';
assert.match(socket, /^\/tmp\/lms-lifecycle-mysql\.[^/]+\/mysql\.sock$/);
const database = `calendar_lifecycle_${Date.now()}_test`;
const mysql = (sql, useDatabase = true) => execFileSync('mysql', [
  '--no-defaults', '--protocol=SOCKET', `--socket=${socket}`, '-uroot',
  '--batch', '--raw', '--skip-column-names', ...(useDatabase ? [database] : []),
], { input: sql, encoding: 'utf8' }).trim();
const jobs = key => {
  const output = mysql(`SELECT payload FROM hocmai_sync_queue WHERE c_key='${key}' ORDER BY id`);
  return output ? output.split('\n').map(JSON.parse) : [];
};
const insertCalendar = key => mysql(`INSERT INTO calendar (\`key\`,code,learn_number,start_time,end_time,lesson_document)
  VALUES ('${key}','nguvan-6-2027',7,'2031-11-02 18:00:00','2031-11-02 19:30:00','["doc.pdf"');`);
let created = false;
try {
  mysql(`CREATE DATABASE ${database}`, false);
  created = true;
  mysql(`
    CREATE TABLE calendar (
      id INT AUTO_INCREMENT PRIMARY KEY, \`key\` VARCHAR(100), code VARCHAR(100),
      deleted_at DATETIME(3), start_time DATETIME, end_time DATETIME,
      subject TEXT, teacher TEXT, lesson_name TEXT, learn_number INT,
      lesson_document LONGTEXT, lesson_status INT DEFAULT 0, lesson_noti TEXT
    );
    CREATE TABLE package_lesson_mapping (
      id INT AUTO_INCREMENT PRIMARY KEY, \`key\` VARCHAR(100), package_id VARCHAR(50), lesson_id VARCHAR(50)
    );
    CREATE TABLE hocmai_sync_queue (
      id INT AUTO_INCREMENT PRIMARY KEY, c_key VARCHAR(100), action VARCHAR(50), payload JSON, status INT
    );
  `);
  mysql(readFileSync(path.resolve(__dirname, '../prisma/sql/calendar_triggers.sql'), 'utf8'));

  for (const [key, values] of [['absent', []], ['empty', ["''"]], ['null', ['NULL']], ['blank', ["'   '"]]]) {
    insertCalendar(key);
    for (const lesson of values) mysql(`INSERT INTO package_lesson_mapping (\`key\`,package_id,lesson_id) VALUES ('${key}','10',${lesson})`);
    mysql(`UPDATE calendar SET deleted_at=NOW() WHERE \`key\`='${key}'`);
    mysql(`UPDATE calendar SET deleted_at=NULL WHERE \`key\`='${key}'`);
    assert.deepEqual(jobs(key), [], `${key} mappings must not enqueue delete or restore`);
  }

  // Another calendar's mapping must not enable this key.
  mysql("INSERT INTO package_lesson_mapping (`key`,package_id,lesson_id) VALUES ('other','10','20')");
  mysql("UPDATE calendar SET deleted_at=NOW() WHERE `key`='absent'");
  assert.deepEqual(jobs('absent'), []);

  mysql("INSERT INTO package_lesson_mapping (`key`,package_id,lesson_id) VALUES ('mixed','10','20'),('mixed','11',''),('mixed','12',NULL)");
  insertCalendar('mixed');
  mysql("UPDATE calendar SET teacher='Teacher' WHERE `key`='mixed'");
  mysql("UPDATE calendar SET deleted_at=NOW() WHERE `key`='mixed'");
  mysql("UPDATE calendar SET deleted_at=NOW() WHERE `key`='mixed'");
  mysql("UPDATE calendar SET deleted_at=NULL WHERE `key`='mixed'");
  const mixed = jobs('mixed');
  assert.deepEqual(mixed.map(job => job.action), ['create', 'update', 'delete', 'restore']);
  for (const job of mixed.filter(job => job.action !== 'delete')) {
    assert.equal(job.code, 'nguvan-6-2027');
    assert.equal(job.start_time, '2031-11-02 18:00:00');
    assert.equal(job.end_time, '2031-11-02 19:30:00');
    assert.equal(job.learn_number, 7);
    assert.deepEqual(job.documents, ['doc.pdf']);
  }
  assert.deepEqual(mixed.at(-1).packages, [{ package_id: '10', lesson_id: '20' }]);

  // Nullable source fields must use the same defaults for all three actions.
  mysql("INSERT INTO package_lesson_mapping (`key`,package_id,lesson_id) VALUES ('null-fields','10','20')");
  mysql("INSERT INTO calendar (`key`,code,start_time,end_time,subject,teacher,lesson_name,learn_number,lesson_status,lesson_noti,lesson_document) VALUES ('null-fields','nguvan-6-2027',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)");
  mysql("UPDATE calendar SET lesson_document='[]' WHERE `key`='null-fields'");
  mysql("UPDATE calendar SET deleted_at=NOW() WHERE `key`='null-fields'");
  mysql("UPDATE calendar SET deleted_at=NULL WHERE `key`='null-fields'");
  const nullJobs = jobs('null-fields').filter(job => job.action !== 'delete');
  assert.deepEqual(nullJobs.map(job => job.action), ['create', 'update', 'restore']);
  const expectedDefaults = {
    c_key: 'null-fields', code: 'nguvan-6-2027', subject: '', start_time: '', end_time: '',
    teacher_name: '', title: '', learn_number: 0, lesson_status: 0, lesson_noti: '', documents: [],
  };
  for (const job of nullJobs) {
    const fields = Object.fromEntries(Object.keys(expectedDefaults).map(key => [key, job[key]]));
    assert.deepEqual(fields, expectedDefaults, `${job.action} must normalize nullable fields consistently`);
  }
  assert.deepEqual(nullJobs.at(-1).packages, [{ package_id: '10', lesson_id: '20' }]);

  // Removing mappings before delete must suppress both lifecycle jobs.
  insertCalendar('removed');
  mysql("INSERT INTO package_lesson_mapping (`key`,package_id,lesson_id) VALUES ('removed','10','20')");
  mysql("DELETE FROM package_lesson_mapping WHERE `key`='removed'");
  mysql("UPDATE calendar SET deleted_at=NOW() WHERE `key`='removed'");
  mysql("UPDATE calendar SET deleted_at=NULL WHERE `key`='removed'");
  assert.deepEqual(jobs('removed'), []);

  // Unrecoverable documents become [], including on restore.
  mysql("UPDATE calendar SET lesson_document='broken-json', deleted_at=NOW() WHERE `key`='mixed'");
  mysql("UPDATE calendar SET deleted_at=NULL WHERE `key`='mixed'");
  assert.deepEqual(jobs('mixed').at(-1).documents, []);

  // Manual queue mode must continue to suppress DB trigger jobs.
  const before = jobs('mixed').length;
  mysql("SET @lms_manual_hocmai_queue=1; UPDATE calendar SET deleted_at=NOW() WHERE `key`='mixed'; UPDATE calendar SET deleted_at=NULL WHERE `key`='mixed';");
  assert.equal(jobs('mixed').length, before);
  console.log('PASS: real MySQL lifecycle guards, filtered mappings, full restore payload, document repair and manual queue mode');
} finally {
  if (created) mysql(`DROP DATABASE ${database}`, false);
}
