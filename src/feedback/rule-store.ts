import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { SavedRule } from './contract.ts';

export function createRuleStore(path: string) {
  async function load(): Promise<SavedRule | null> {
    let text: string;
    try { text = await readFile(path, 'utf8'); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const rule = JSON.parse(text);
    if (!rule || typeof rule.text !== 'string' || !rule.text.trim() || rule.text.length > 2000
      || typeof rule.enabled !== 'boolean' || typeof rule.confirmedAt !== 'string' || !Number.isFinite(Date.parse(rule.confirmedAt))
      || typeof rule.updatedAt !== 'string' || !Number.isFinite(Date.parse(rule.updatedAt))) throw new Error('本地规则记录无效');
    return rule;
  }
  async function write(rule: SavedRule): Promise<SavedRule> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(rule, null, 2) + '\n', 'utf8');
      // 整份替换，避免下一次请求读到写入一半的规则。
      await rename(temp, path);
    } finally { await rm(temp, { force: true }); }
    return rule;
  }
  return {
    load,
    async save(text: string): Promise<SavedRule> {
      const now = new Date().toISOString();
      return write({ text, enabled: true, confirmedAt: now, updatedAt: now });
    },
    async disable(): Promise<SavedRule | null> {
      const rule = await load();
      return rule ? write({ ...rule, enabled: false, updatedAt: new Date().toISOString() }) : null;
    },
  };
}
