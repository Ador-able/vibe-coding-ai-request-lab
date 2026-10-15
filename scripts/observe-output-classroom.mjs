import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DefaultChatTransport, readUIMessageStream } from 'ai';
import { SOURCES } from '../src/novel-materials.ts';
import { codeVersion } from '../src/version.ts';

const lesson = process.argv[2];
const folders = { structured: '122-结构化', streaming: '123-流式', messages: '168-消息', requests: '174-请求状态' };
if (!Object.hasOwn(folders, lesson)) throw new Error('请选择 structured、streaming、messages 或 requests。');
const base = `http://127.0.0.1:${process.env.LAB_PORT || 4359}`;
const directory = resolve('records/凡人修仙传/20261015', folders[lesson]);
const destination = resolve(directory, '实际入口记录.json');
if (existsSync(destination)) throw new Error('此轮记录已存在，不覆盖或按答案重跑。新课堂请明确使用新的记录目录。');
mkdirSync(directory, { recursive: true });
const evidence = { lesson, sourceVersion: codeVersion(), beganAt: new Date().toISOString(),
  origin: '实际HTTP与AI SDK入口；没有操作浏览器', http: [], cases: [], error: null };
const save = () => writeFileSync(destination, JSON.stringify(evidence, null, 2) + '\n');
async function api(path, body) {
  const receipt = { path, method: body === undefined ? 'GET' : 'POST', at: new Date().toISOString(), input: body ?? null, status: null, output: null };
  evidence.http.push(receipt); save();
  const response = await fetch(base + path, { method: receipt.method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  receipt.status = response.status; receipt.output = await response.json(); save();
  return receipt.output;
}
async function terminalRecord(path) {
  let record;
  // 只按同编号读回已有工作；不重新提交或重试模型。
  for (let i = 0; i < 50; i++) {
    record = await api(path);
    if (record.state !== 'running') break;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  return record;
}
async function consume(path, body, onEvent, signal) {
  const observation = { path, input: body, events: [], snapshots: [], finalMessage: null, error: null, httpStatus: null };
  evidence.cases.push(observation); save();
  const transport = new DefaultChatTransport({ api: base + path, fetch: async (url, init) => {
    const response = await fetch(url, init); observation.httpStatus = response.status; return response;
  }, prepareSendMessagesRequest: () => ({ body }) });
  try {
    const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: body.runId ?? body.id,
      messageId: undefined, messages: [], abortSignal: signal });
    const recorded = stream.pipeThrough(new TransformStream({ async transform(event, controller) {
      observation.events.push({ at: new Date().toISOString(), event: structuredClone(event) }); save();
      await onEvent?.(event); controller.enqueue(event);
    } }));
    for await (const message of readUIMessageStream({ stream: recorded, onError: error => {
      observation.error = { name: error.name, message: error.message }; save();
    } })) {
      observation.snapshots.push(structuredClone(message)); observation.finalMessage = structuredClone(message); save();
    }
  } catch (error) { observation.error = { name: error.name, message: error.message }; }
  save(); return observation;
}
try {
  if (lesson === 'structured') {
    const material = SOURCES[1].text;
    for (const mode of ['prompt', 'object', 'strict']) {
      const response = await api('/api/structured/extract', { material, mode });
      evidence.cases.push({ mode, response }); save();
    }
  } else if (lesson === 'streaming') {
    for (const condition of ['normal', 'stop-in-questions']) {
      const runId = randomUUID(); let stopped = false;
      const observed = await consume('/api/streaming/run', { runId, material: SOURCES[1].text }, async event => {
        if (condition === 'stop-in-questions' && !stopped && event.type === 'text-delta' && event.id === 'questions') {
          stopped = true; await api(`/api/streaming/${runId}/stop`, {});
        }
      });
      observed.condition = condition; observed.record = await terminalRecord(`/api/streaming/${runId}/record`); save();
    }
  } else if (lesson === 'messages') {
    for (const fixtureKey of ['normal', 'stopped']) {
      const created = await api('/api/messages/conversations', { fixtureKey });
      const id = created.view.conversation.id;
      const observed = { fixtureKey, conversationId: id, reads: [], prepared: null };
      evidence.cases.push(observed); save();
      for (const phase of fixtureKey === 'normal' ? ['snapshotEarly', 'snapshotLater', 'final'] : ['final']) {
        await api(`/api/messages/conversations/${id}/import`, { phase });
        observed.reads.push({ phase, view: await api(`/api/messages/conversations/${id}`) });
      }
      if (fixtureKey === 'normal') {
        await api(`/api/messages/conversations/${id}/feedback`, { note: '这是凡人原文回显，不是模型摘要。' });
        observed.beforeLock = await api(`/api/messages/conversations/${id}`);
        // 教师用独立连接持有写锁，观察真实保存失败；不是模型生成错误。
        const lock = new DatabaseSync(resolve('.data/凡人输出课堂-20261015/messages.sqlite'));
        lock.exec('BEGIN IMMEDIATE');
        try {
          observed.lockedSave = await api(`/api/messages/conversations/${id}/feedback`, {
            note: '这是凡人原文回显，不是模型摘要；未完成文字不能作为成功历史。',
          });
          observed.duringLock = await api(`/api/messages/conversations/${id}`);
        } finally { lock.exec('ROLLBACK'); lock.close(); }
      }
      await api(`/api/messages/conversations/${id}/feedback`, { note: '这是凡人原文回显，不是模型摘要；未完成文字不能作为成功历史。' });
      observed.feedbackReadback = await api(`/api/messages/conversations/${id}`);
      observed.prepared = await api(`/api/messages/conversations/${id}/prepare`, {}); save();
    }
  } else {
    const catalog = await api('/api/requests/catalog');
    const conditions = [['A', 'normal'], ['B', 'permission'], ['B', 'manual-stop'], ['A', 'normal'],
      ['A', 'timeout'], ['B', 'retry-before-stream'], ['B', 'error-during-stream'], ['B', 'disconnect']];
    for (const [fixtureKey, condition] of conditions) {
      const id = randomUUID(), controller = new AbortController(); let stopped = false;
      const body = { id, fixtureKey, scenario: condition === 'manual-stop' ? 'normal' : condition,
        messages: [{ id: `${id}-user`, role: 'user', parts: [{ type: 'text', text: catalog.fixtures[fixtureKey].input }] }] };
      const observed = await consume('/api/requests', body, async event => {
        if (condition === 'manual-stop' && !stopped && event.type === 'text-delta' && event.delta.length) {
          stopped = true; await api(`/api/requests/${id}/cancel`, {});
          controller.abort(new DOMException('课堂操作：停止本地HTTP消费', 'AbortError'));
        }
      }, controller.signal);
      observed.condition = condition; observed.record = await terminalRecord(`/api/requests/${id}`); save();
    }
  }
} catch (error) {
  evidence.error = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  evidence.endedAt = new Date().toISOString();
  evidence.materials = SOURCES.slice(0, 2).map(source => ({ id: source.id, title: source.title,
    sha256: createHash('sha256').update(source.text).digest('hex') }));
  save(); console.log(JSON.stringify({ lesson, file: destination, cases: evidence.cases.length, error: evidence.error }));
}
