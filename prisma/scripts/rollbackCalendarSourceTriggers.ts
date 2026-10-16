// Maintenance only: stop calendar writers and disable Feed callers before running.
// Refuse legacy triggers if they could enqueue any existing Feed calendars.
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import dotenv from 'dotenv';

dotenv.config();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
const url = new URL(process.env.DATABASE_URL);
const args = ['--protocol=TCP', '-h', url.hostname, '-P', url.port || '3306', '-u', decodeURIComponent(url.username), url.pathname.replace(/^\//, '')];
const execute = (sql: string) => {
  const result = spawnSync('mysql', [...args, '--batch', '--skip-column-names'], {
    input: sql,
    env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) },
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'MySQL rollback failed');
  return result.stdout.trim();
};
const feedCount = execute("SELECT COUNT(*) FROM calendar WHERE code LIKE 'feed-%';");
if (feedCount !== '0') {
  throw new Error('Không phục hồi trigger cũ khi còn lịch Feed. Giữ cột nguồn và trigger có guard; chỉ rollback ứng dụng.');
}
execute(readFileSync(resolve(__dirname, '../sql/rollback_calendar_source_triggers.sql'), 'utf8'));
console.log('Legacy calendar triggers restored. All calendar data and program codes were retained.');
