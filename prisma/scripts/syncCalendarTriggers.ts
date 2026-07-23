import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is not configured');
}

const url = new URL(databaseUrl);
const sqlPath = resolve(__dirname, '../sql/calendar_triggers.sql');
const sql = readFileSync(sqlPath, 'utf8');
const args = [
  '--protocol=TCP',
  '-h',
  url.hostname,
  '-P',
  url.port || '3306',
  '-u',
  decodeURIComponent(url.username),
  url.pathname.replace(/^\//, ''),
];

const result = spawnSync('mysql', args, {
  input: sql,
  env: {
    ...process.env,
    MYSQL_PWD: decodeURIComponent(url.password),
  },
  stdio: ['pipe', 'inherit', 'inherit'],
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('Calendar sync triggers have been recreated with the current database user.');
