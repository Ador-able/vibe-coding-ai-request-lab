import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline';
import { appendFileSync, existsSync } from 'node:fs';

const { values } = parseArgs({ options: { db: { type: 'string' }, log: { type: 'string' } } });
if (!values.db || !values.log || !existsSync(values.db)) {
  throw new Error('用法：pnpm messages:lock --db <已有数据库> --log <完整锁记录.jsonl>；不会新建数据库。');
}
const db = new DatabaseSync(values.db);
const record = event => {
  const value = { ...event, at: new Date().toISOString(), processId: process.pid };
  appendFileSync(values.log, JSON.stringify(value) + '\n', 'utf8');
  console.log(JSON.stringify(value));
};
const input = createInterface({ input: process.stdin, output: process.stdout });
let locked = false;
try {
  db.exec('PRAGMA busy_timeout = 0; BEGIN IMMEDIATE');
  locked = true;
  record({ event: 'lock-acquired', sql: 'BEGIN IMMEDIATE', instruction: '独立连接持锁。页面尝试保存后，按 Enter 释放；不会自动重试页面。' });
  await new Promise(resolve => input.once('line', resolve));
} finally {
  if (locked) {
    db.exec('ROLLBACK');
    record({ event: 'lock-released', sql: 'ROLLBACK', instruction: '请回到页面亲自再次保存。' });
  }
  input.close();
  db.close();
}
