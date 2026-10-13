import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { SCENARIOS } from './contract.ts';
import type { Catalog, Fixture, FixtureKey } from './contract.ts';

const directory = resolve('public/requests-fixtures');
export async function loadCatalog(): Promise<Catalog> {
  const manifest: Array<{ filename: string; bytes: number; sha256: string }> = JSON.parse(await readFile(resolve(directory, '材料清单.json'), 'utf8'));
  const values = new Map<string, Buffer>();
  for (const entry of manifest) {
    const bytes = await readFile(resolve(directory, entry.filename));
    assert.equal(bytes.length, entry.bytes, `${entry.filename}长度不同`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${entry.filename}字节不同`);
    values.set(entry.filename, bytes);
  }
  const input = JSON.parse(values.get('03-两份完整任务输入.json')!.toString('utf8'));
  const output = JSON.parse(values.get('04-受控输出全文与来源.json')!.toString('utf8'));
  const chunks = JSON.parse(values.get('08-完整文本分段.json')!.toString('utf8'));
  const fixtures = {} as Record<FixtureKey, Fixture>;
  for (const key of ['A', 'B'] as const) {
    const deltas: string[] = chunks[key].chunks.map((part: { delta: string }) => part.delta);
    assert.equal(deltas.join(''), output[key].text, `${key}分段与全文不同`);
    fixtures[key] = { key, title: input[key].prompt.split('\n')[0], instructions: input[key].instructions,
      input: input[key].prompt, answer: output[key].text, deltas,
      answerOrigin: output[key].origin, source: output[key].source ?? { kind: 'teacher-authored' } };
  }
  return { sdkVersion: '7.0.122', fixtures, scenarios: SCENARIOS,
    files: manifest.map(entry => ({ file: entry.filename, bytes: entry.bytes, sha256: entry.sha256 })) };
}
