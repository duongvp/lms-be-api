import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cancelWaitingCalendarStatuses } from '../src/modules/livestream/calendar-lifecycle';
import { cancelSupersededCanceledStatuses } from '../src/modules/livestream/hocmai-canceled-status.service';

// Explicit disposable socket only. Never loads database settings or calls HMO.
const socket = process.env.TEST_HOCMAI_SYNC_MYSQL_SOCKET;
const exec = promisify(execFile);
test('LMS cancels only superseded unsent prerequisites on disposable MySQL', { skip: !socket }, async () => {
  assert.match(socket!, /^\/tmp\/hocmai-sync-worker-test-[\w-]+\/mysql\.sock$/);
  async function sql(query: string) {
    const { stdout } = await exec('mysql', ['--no-defaults', '--protocol=SOCKET', `--socket=${socket}`,
      '-uroot', '--batch', '--raw', '-e', query]);
    return stdout.trimEnd();
  }
  const database = 'hocmai_lms_gate_test';
  await sql(`CREATE DATABASE ${database}`);
  let lastQuery = '';
  const client: any = { $executeRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
    lastQuery = parts.reduce((query, part, i) => query + part + (i < values.length
      ? `CONVERT(X'${Buffer.from(String(values[i])).toString('hex')}' USING utf8mb4)` : ''), '');
    const output = await sql(`USE ${database}; ${lastQuery}; SELECT ROW_COUNT() AS affected`);
    return Number(output.split('\n').at(-1));
  } };
  const states = async () => (await sql(`USE ${database}; SELECT status FROM hocmai_sync_queue ORDER BY id`))
    .split('\n').slice(1).map(Number);
  try {
    await sql(`USE ${database}; CREATE TABLE hocmai_sync_queue (
      id INT PRIMARY KEY AUTO_INCREMENT, c_key VARCHAR(100), action VARCHAR(20), status TINYINT,
      last_error TEXT, INDEX(c_key,id)) ENGINE=InnoDB;
      INSERT INTO hocmai_sync_queue(c_key,action,status) VALUES
      ('K','update-status-lesson',0), ('K','update-status-lesson',1),
      ('K','update-status-lesson',2), ('K','update-status-lesson',3),
      ('K','update-status-lesson',4), ('K','create',4), ('other','update-status-lesson',4)`);
    await cancelWaitingCalendarStatuses(client, 'K');
    assert.deepEqual(await states(), [0,1,2,3,5,4,4]);

    await sql(`USE ${database}; TRUNCATE hocmai_sync_queue;
      INSERT INTO hocmai_sync_queue(c_key,action,status) VALUES
      ('K','update-status-lesson',4), ('K','delete',0), ('K','restore',0),
      ('K','update-status-lesson',4), ('other','update-status-lesson',4),
      ('K','update-status-lesson',3)`);
    assert.equal(await cancelSupersededCanceledStatuses(client), 1);
    assert.deepEqual(await states(), [5,0,0,4,4,3]);
    assert.equal(await cancelSupersededCanceledStatuses(client), 0);
    // The same SQL participates in the caller's transaction and rolls back with it.
    await sql(`USE ${database}; UPDATE hocmai_sync_queue SET status=4 WHERE id=1;
      START TRANSACTION; ${lastQuery}; ROLLBACK`);
    assert.deepEqual(await states(), [4,0,0,4,4,3]);
  } finally {
    await sql(`DROP DATABASE ${database}`);
  }
});
