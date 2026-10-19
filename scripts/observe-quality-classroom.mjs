import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createApp } from '../src/server.ts';
import { CASES, caseMessages } from '../src/quality/materials.ts';

const directory = resolve(process.argv[2] || `records/凡人修仙传/材料对照-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(directory, { recursive: true });
const save = async (name, value) => writeFile(resolve(directory, name), JSON.stringify(value, null, 2) + '\n');
const sourcePaths = ['src/quality/materials.ts', 'src/quality/contract.ts', 'src/quality/assess.ts', 'src/quality/routes.ts', 'src/quality/main.ts', 'materials/凡人修仙传/原文片段.json'];
const hashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
// 在发出请求之前落盘问题、材料和评分标准，后续只按原样核对。
await save('运行前固定条件.json', { savedAt: new Date().toISOString(), hashes, cases: CASES.map(item => ({ ...item, messages: caseMessages(item) })) });
const server = createServer(createApp(undefined, () => {}));
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const batch = { id: randomUUID(), startedAt: new Date().toISOString(), results: [], state: 'running' };
try {
  for (const [index, item] of CASES.entries()) {
    const response = await fetch(`${origin}/api/quality/case`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: item.id }), signal: AbortSignal.timeout(190_000) });
    const data = await response.json();
    await save(`${String(index + 1).padStart(2, '0')}-${item.id}.json`, { localHttpStatus: response.status, ...data });
    batch.results.push(data.result);
    console.log(JSON.stringify({ condition: item.condition, httpStatus: data.result?.request?.httpStatus, answer: data.result?.answer, assessment: data.result?.assessment, error: data.result?.error }));
    if (!response.ok || !data.ok || data.result?.error) { batch.state = 'failed'; break; }
  }
  if (batch.state === 'running') batch.state = 'complete';
  await save('完整运行.json', batch);
  // 页面回放真实请求的结果；失败时保留已有课堂实录和本次已取得的记录。
  if (batch.state === 'complete') await writeFile('public/records/凡人修仙传-quality.json', JSON.stringify(batch, null, 2) + '\n');
  console.log(JSON.stringify({ directory, state: batch.state, results: batch.results.length }));
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
