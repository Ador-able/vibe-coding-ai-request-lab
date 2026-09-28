import './style.css';
import { MATERIAL } from './material.ts';
import { DefaultChatTransport, readUIMessageStream } from 'ai';
import type { AssistantMessage, Chunk, RunRecord, State } from './contract.ts';

document.querySelector<HTMLElement>('#app')!.innerHTML = `<header><span class="eyebrow">文档助手 · 教学虚构</span><h1>先摘要，再提出待确认问题</h1><p>两段输出属于同一条助手消息。进度来自应用实际阶段，文字随模型响应到达。</p></header>
  <label for="material">工作纪要，可直接修改</label><textarea id="material" rows="5" maxlength="6000"></textarea>
  <div class="actions"><button id="run">生成摘要和问题</button><button id="stop" class="secondary" hidden>停止</button><span id="model" class="note"></span></div>
  <p id="status" role="status" aria-live="polite"></p>
  <section id="assistant" hidden><div class="message-heading"><h2>助手回复</h2><span id="progress" class="progress"></span></div><p class="note">以下为本次收到的文字；完成状态不代表内容已核实。</p><div id="message"></div><p id="metadata" class="note"></p></section>
  <details id="records" hidden><summary>本次记录：事件顺序与原始请求</summary><div class="inspector-body"><div class="record-tools"><label for="attempt">查看请求<select id="attempt"></select></label><button id="download" class="secondary">下载全部记录</button></div>
    <p id="record-label" class="note"></p><p class="note">这是已收到的事件列表，不是延迟播放。UI时间从浏览器发起本次请求起算；模型SSE时间从各阶段发起上游请求起算。事件块不等于单个token。</p>
    <div class="table-scroll"><table><thead><tr><th>顺序 / 毫秒</th><th>UI事件</th><th>内容</th></tr></thead><tbody id="events"></tbody></table></div>
    <details><summary>完整脱敏记录</summary><pre id="raw-record"></pre></details></div></details>`;
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
get<HTMLTextAreaElement>('material').value = MATERIAL;
type Attempt = { id: string; material: string; state: State; message: AssistantMessage | null; events: { elapsedMs: number; event: Chunk }[]; serverRecord: RunRecord | null; error: string | null };
const attempts: Attempt[] = [];
let current = -1; let busy = false; let stopping = false;
const stateLabel = { running: '进行中', completed: '已完成', stopped: '已停止，未完成', failed: '未完成' };

function eventDescription(event: Chunk) {
  if (event.type === 'text-delta') return `${event.id}：${event.delta}`;
  if (event.type === 'data-progress') return `${event.id} → ${event.data.label}`;
  if (event.type === 'start') return `消息 ${event.messageId}`;
  if (event.type === 'text-start' || event.type === 'text-end') return event.id;
  if (event.type === 'finish') return `整条消息结束 · ${event.finishReason}`;
  if (event.type === 'error') return event.errorText;
  if (event.type === 'abort') return event.reason || '中止';
  if (event.type === 'message-metadata') return '更新消息的状态、型号与各阶段用量';
  if (event.type === 'finish-step') return '本次模型调用结束';
  if (event.type === 'start-step') return '本次模型调用开始';
  return event.type;
}
function render() {
  const attempt = attempts[current];
  get<HTMLButtonElement>('run').disabled = busy; get<HTMLTextAreaElement>('material').disabled = busy;
  get('stop').hidden = !busy; get<HTMLButtonElement>('stop').disabled = stopping || !attempt?.events.some(({ event }) => event.type === 'start');
  get('stop').textContent = stopping ? '正在停止…' : '停止';
  get('status').textContent = attempt ? stopping ? '已请求停止，正在结束上游读取…' : attempt.error || stateLabel[attempt.state] : '';
  get('status').className = attempt?.state === 'failed' ? 'error' : '';
  get('assistant').hidden = !attempt; get('records').hidden = !attempt;
  if (!attempt) return;
  const progress = attempt.message?.parts.find((part) => part.type === 'data-progress');
  get('progress').textContent = progress?.type === 'data-progress' ? progress.data.label : '等待消息开始';
  const content = get('message'); content.replaceChildren();
  const textParts = attempt.message?.parts.filter((part) => part.type === 'text') ?? [];
  textParts.forEach((part, i) => {
    const section = document.createElement('section'); const heading = document.createElement('h3'); heading.textContent = i === 0 ? '摘要' : '待确认问题';
    const text = document.createElement('p'); text.className = 'answer'; text.textContent = part.text || '等待正文片段…'; section.append(heading, text); content.append(section);
  });
  const metadata = attempt.message?.metadata;
  get('metadata').textContent = metadata ? `消息状态：${stateLabel[metadata.state]} · ${metadata.model} · ${metadata.stages.map((s) => `${s.stage === 'summary' ? '摘要' : '问题'}结束原因 ${s.finishReason ?? '未收到'}`).join('；')}` : '';
  const choice = get<HTMLSelectElement>('attempt'); choice.replaceChildren(...attempts.map((item, i) => new Option(`第${i + 1}次 · ${stateLabel[item.state]}`, String(i)))); choice.value = String(current); choice.disabled = busy;
  get<HTMLButtonElement>('download').disabled = busy;
  get('record-label').textContent = `本次记录 · ${stateLabel[attempt.state]} · ${attempt.events.length}个UI事件`;
  const rows = get('events'); rows.replaceChildren();
  attempt.events.forEach(({ elapsedMs, event }, i) => {
    const tr = document.createElement('tr');
    for (const value of [`${i + 1} / ${elapsedMs}`, event.type, eventDescription(event)]) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
    rows.append(tr);
  });
  get('raw-record').textContent = JSON.stringify(attempt, null, 2);
}

get('run').addEventListener('click', async () => {
  if (busy) return;
  const material = get<HTMLTextAreaElement>('material').value;
  if (!material.trim()) { get('status').textContent = '请先输入工作纪要。'; return; }
  const attempt: Attempt = { id: crypto.randomUUID(), material, state: 'running', message: null, events: [], serverRecord: null, error: null };
  attempts.push(attempt); current = attempts.length - 1; busy = true; stopping = false; render();
  const start = performance.now();
  let finished = false;
  try {
    const transport = new DefaultChatTransport<AssistantMessage>({ api: '/api/streaming/run', prepareSendMessagesRequest: () => ({ body: { runId: attempt.id, material } }) });
    const incoming = await transport.sendMessages({ trigger: 'submit-message', chatId: attempt.id, messageId: undefined, messages: [], abortSignal: undefined });
    const recorded = incoming.pipeThrough(new TransformStream({ transform(chunk, controller) {
      const event = chunk as Chunk;
      attempt.events.push({ elapsedMs: Math.round((performance.now() - start) * 10) / 10, event });
      if (event.type === 'finish') finished = true;
      if (event.type === 'error') { attempt.state = 'failed'; attempt.error = event.errorText; }
      if (event.type === 'abort') { attempt.state = 'stopped'; attempt.error = event.reason || '已停止，任务未完成。'; }
      controller.enqueue(chunk);
    } }));
    // SDK负责按ID合并文字和进度；页面只渲染消息快照，不自行模拟增量。
    for await (const message of readUIMessageStream<AssistantMessage>({ stream: recorded, onError: () => { attempt.state = 'failed'; attempt.error ||= '消息流处理失败，已有文字保留。'; } })) {
      attempt.message = message; render();
    }
    if (attempt.state === 'running') { attempt.state = finished ? 'completed' : 'failed'; if (!finished) attempt.error = '连接结束，但没有收到整条消息完成事件。'; }
  } catch { attempt.state = 'failed'; attempt.error = '连接或消息流中断，已收到的文字保留；没有自动重试。'; }
  finally {
    try { const response = await fetch(`/api/streaming/${attempt.id}/record`); if (response.ok) attempt.serverRecord = await response.json() as RunRecord; } catch { /* 已收到的客户端事件仍可导出。 */ }
    busy = false; stopping = false; render();
  }
});
get('stop').addEventListener('click', async () => {
  const attempt = attempts[current]; if (!busy || !attempt || stopping) return;
  stopping = true; render();
  try {
    const response = await fetch(`/api/streaming/${attempt.id}/stop`, { method: 'POST' });
    if (!response.ok) throw new Error();
  } catch { stopping = false; attempt.error = '未能确认停止，请重试停止操作。'; render(); }
});
get('attempt').addEventListener('change', () => { current = Number(get<HTMLSelectElement>('attempt').value); render(); });
get('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ attempts }, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = '流式消息-实际事件记录.json'; a.click(); URL.revokeObjectURL(url);
});
void fetch('/api/streaming/info').then((r) => r.json()).then((info) => { get('model').textContent = `${info.model} · 完整任务调用两次`; }).catch(() => { get('model').textContent = '未读取到模型配置'; });
