import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { CompletionState, Conversation, ConversationView, Message, RawRow } from './contract.ts';

export class MessageStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 0;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        source_record_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS messages (
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        message_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK(position > 0),
        role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
        parts_json TEXT NOT NULL,
        metadata_json TEXT,
        completion_state TEXT NOT NULL CHECK(completion_state IN ('submitted','incomplete','completed','stopped')),
        PRIMARY KEY(conversation_id, message_id),
        UNIQUE(conversation_id, position)
      ) STRICT;
    `);
  }

  private transaction(action: () => void): void {
    // 独立连接占有写锁时直接失败，不等待、重试或改成已保存。
    this.db.exec('BEGIN IMMEDIATE');
    try {
      action();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private put(conversationId: string, position: number, message: Message, state: CompletionState): void {
    this.db.prepare(`
      INSERT INTO messages(conversation_id,message_id,position,role,parts_json,metadata_json,completion_state)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(conversation_id,message_id) DO UPDATE SET
        role=excluded.role, parts_json=excluded.parts_json,
        metadata_json=excluded.metadata_json, completion_state=excluded.completion_state
    `).run(conversationId, message.id, position, message.role, JSON.stringify(message.parts),
      message.metadata === undefined ? null : JSON.stringify(message.metadata), state);
  }

  create(sourceRecordId: string, userMessage: Message): string {
    const id = randomUUID();
    this.transaction(() => {
      this.db.prepare('INSERT INTO conversations(id,source_record_id,created_at) VALUES (?,?,?)')
        .run(id, sourceRecordId, new Date().toISOString());
      this.put(id, 1, userMessage, 'submitted');
    });
    return id;
  }

  saveAssistant(conversationId: string, message: Message, state: CompletionState): void {
    this.transaction(() => this.put(conversationId, 2, message, state));
  }

  saveFeedback(conversationId: string, message: Message): void {
    this.transaction(() => this.put(conversationId, 3, message, 'submitted'));
  }

  read(conversationId: string): ConversationView | undefined {
    const row = this.db.prepare('SELECT id,source_record_id,created_at FROM conversations WHERE id=?')
      .get(conversationId) as { id: string; source_record_id: string; created_at: string } | undefined;
    if (!row) return undefined;
    const rawRows = this.db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY position')
      .all(conversationId) as RawRow[];
    const conversation: Conversation = {
      id: row.id, sourceRecordId: row.source_record_id, createdAt: row.created_at,
    };
    const messages = rawRows.map(item => {
      const message: Message = {
        id: item.message_id, role: item.role, parts: JSON.parse(item.parts_json),
      };
      // SQL NULL 代表原来没有 metadata，JSON 文本 "null" 则仍会读回 null。
      if (item.metadata_json !== null) message.metadata = JSON.parse(item.metadata_json);
      return message;
    });
    return { conversation, messages, rawRows, entries: rawRows.map(item => ({
      messageId: item.message_id, position: item.position, completionState: item.completion_state,
    })) };
  }

  list(): Conversation[] {
    return (this.db.prepare('SELECT id,source_record_id,created_at FROM conversations ORDER BY created_at,id')
      .all() as { id: string; source_record_id: string; created_at: string }[])
      .map(row => ({ id: row.id, sourceRecordId: row.source_record_id, createdAt: row.created_at }));
  }

  close(): void { this.db.close(); }
}
