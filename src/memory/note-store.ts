import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TEACHING_NOTE } from './materials.ts';
import type { SavedNote } from './contract.ts';

export function createNoteStore(path: string) {
  return {
    async save(): Promise<SavedNote> {
      const record: SavedNote = { origin: 'reader-confirmed-teaching-note', confirmedAt: new Date().toISOString(), note: TEACHING_NOTE };
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(record, null, 2) + '\n', 'utf8');
      return record;
    },
    async load(): Promise<SavedNote | null> {
      let text: string;
      try { text = await readFile(path, 'utf8'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      const record = JSON.parse(text);
      if (record?.origin !== 'reader-confirmed-teaching-note' || typeof record.confirmedAt !== 'string'
          || !Number.isFinite(Date.parse(record.confirmedAt)) || JSON.stringify(record.note) !== JSON.stringify(TEACHING_NOTE)) {
        throw new Error('本地便笺内容不符合当前教学记录');
      }
      return record;
    },
  };
}
