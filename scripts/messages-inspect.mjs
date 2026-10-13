import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';

const { values } = parseArgs({ options: {
  db: { type: 'string' }, conversation: { type: 'string' }, out: { type: 'string' },
} });
if (!values.db || !values.out) throw new Error('用法：pnpm messages:inspect --db <已有数据库> --out <完整JSON> [--conversation <会话ID>]');
const db = new DatabaseSync(values.db, { readOnly: true });
try {
  const conversations = values.conversation
    ? db.prepare('SELECT * FROM conversations WHERE id=? ORDER BY created_at,id').all(values.conversation)
    : db.prepare('SELECT * FROM conversations ORDER BY created_at,id').all();
  const rows = values.conversation
    ? db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY position').all(values.conversation)
    : db.prepare('SELECT * FROM messages ORDER BY conversation_id,position').all();
  const messages = rows.map(row => {
    const message = { id: row.message_id, role: row.role, parts: JSON.parse(row.parts_json) };
    if (row.metadata_json !== null) message.metadata = JSON.parse(row.metadata_json);
    return { conversationId: row.conversation_id, position: row.position,
      completionState: row.completion_state, message };
  });
  writeFileSync(values.out, JSON.stringify({ readAt: new Date().toISOString(),
    connection: '本次新建只读SQLite连接', conversations, rawRows: rows, messages }, null, 2), 'utf8');
  console.log(JSON.stringify({ output: values.out, conversations: conversations.length, messages: rows.length, readOnly: true }));
} finally { db.close(); }
