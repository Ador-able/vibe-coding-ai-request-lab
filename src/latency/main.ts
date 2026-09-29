import './style.css';
import '../lab.css';
import { CONDITIONS, QUESTION, type Condition } from './materials.ts';
import { usageOf, type ClientEvent, type StreamRecord } from './contract.ts';
import { readEvents } from './sse.ts';

const app = document.querySelector<HTMLElement>('#app')!;
const entries = Object.entries(CONDITIONS) as [Condition, (typeof CONDITIONS)[Condition]][];
app.innerHTML = `
  <header><a href="/">请求观察室</a><span class="eyebrow">流式观察 · 教学虚构手册</span>
    <h1>等待与用量</h1>
    <p>逐次比较输入长度、重复前缀与输出长度。每次运行调用模型 1 次。</p>
  </header>
  <section class="experiment">
    <p class="question">${QUESTION}</p>
    <p class="note">按顺序各运行一次，比较等待时间与实际用量。</p>
    <div class="table-scroll"><table><thead><tr><th>条件</th><th>操作</th><th>首段正文</th><th>流结束</th><th>输入 token</th><th>其中命中缓存</th><th>输出 token</th></tr></thead><tbody id="comparison-body"></tbody></table></div>
    <p id="status" role="status" aria-live="polite">先运行短材料，观察首段正文何时出现。</p>
    <div class="answer-area"><div class="section-heading"><h3 id="answer-label">实际回答</h3><span id="answer-state" class="note">尚未调用</span></div><p id="answer" class="answer">运行后在这里显示真实流式返回。</p></div>
  </section>
  <div class="download-bar"><button id="download" class="secondary" disabled>下载全部记录</button><span class="note">表格显示最近一次，下载保留全部尝试。</span></div>
  <details id="inspector"><summary>查看实际请求、用量和 SSE 事件</summary><div class="inspector-body">
    <label for="record-choice">选择记录 </label><select id="record-choice"><option value="">尚无记录</option></select>
    <div id="record-content"><p class="note">原始请求不包含认证请求头；事件时间从后端发起模型请求时算起。</p></div>
  </div></details>
  <details><summary>这些时间与用量怎样读</summary><div class="guide-body"><dl>
    <dt>首段正文</dt><dd>从本机后端发起上游 fetch，到收到第一个非空 delta.content。空角色块、空字符串和用量块不计入。</dd>
    <dt>流结束</dt><dd>同一起点到收到 [DONE]，或上游事件流正常结束。异常中断不冒充完成；finish_reason=length 会标明截断。</dd>
    <dt>事件与 token</dt><dd>一个流式片段可能包含多个 token。事件时间不是模型内部的精确 token 间隔，也不是 GPU 预填充耗时。</dd>
    <dt>缓存用量</dt><dd>命中缓存 token 是输入 token 的子集，不再加一次。字段缺失显示“未提供”，不等于 0；重复前缀也不保证命中。</dd>
    <dt>费用</dt><dd>输入、命中缓存的输入与输出需按当前模型和地域价格分别核算；这里记录实际用量，不按总 token 直接换算费用。</dd>
  </dl></div></details>
  <details id="materials"><summary>查看固定材料与对照条件</summary><div class="guide-body">
    <p>qwen-flash · 非思考 · 温度 0，不自动重试。单轮等待受网络、服务调度等影响，不是性能排名。</p><p>手册为人工编写的 40 条虚构产品说明，短材料直接取其中 M21。同一问题放在材料之后。第 3 项与第 2 项请求体完全相同；第 4 项只改最前面的实验版本 A→B，不改变产品版本、手册和问题。</p>
    <p>第 5 项保持长资料，末尾改为约 350 字的说明要求，并将输出上限从 96 改为 512。它同时观察输出要求与实际生成长度，不把差异全归因于上限。</p>
    <pre id="materials-content">展开后加载实际材料。</pre>
  </div></details>`;

type Attempt = { condition: Condition; record?: StreamRecord; transportError?: string; settled: boolean };
const attempts: Attempt[] = [];
let running = false;
let selected = -1;
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const time = (value: number | null) => value === null ? '—' : `${(value / 1000).toFixed(2)} 秒`;
const count = (value: number | null, ended: boolean) => value === null ? ended ? '未提供' : '—' : value.toLocaleString('zh-CN');

function renderTable() {
  const next = entries.find(([key]) => !attempts.some((attempt) => attempt.condition === key));
  get('comparison-body').innerHTML = entries.map(([condition, info], index) => {
    const attempt = attempts.findLast((item) => item.condition === condition);
    const record = attempt?.record;
    const usage = usageOf(record?.usage);
    const note = attempt?.transportError ? '连接失败，见明细' : record?.error ? record.error.message : '';
    return `<tr><td><strong>${index + 1}. ${info.label}</strong><small>${info.description}</small>${note ? `<small class="error">${escape(note)}</small>` : ''}</td>
      <td><button data-run="${condition}" class="${next?.[0] === condition ? '' : 'secondary'}" ${running ? 'disabled' : ''}>${attempt && !attempt.settled ? '接收中…' : attempt ? '再次运行' : '运行一次'}</button></td>
      <td>${time(record?.firstContentMs ?? null)}</td><td>${time(record?.streamEndMs ?? null)}</td>
      <td>${count(usage.input, !!attempt?.settled)}</td><td>${count(usage.cached, !!attempt?.settled)}</td><td>${count(usage.output, !!attempt?.settled)}</td></tr>`;
  }).join('');
}

function renderAnswer(attempt: Attempt) {
  get('answer-label').textContent = CONDITIONS[attempt.condition].label;
  get('answer').textContent = attempt.record?.answer || (attempt.settled ? '没有收到正文。' : '等待第一段正文…');
  get('answer-state').textContent = attempt.transportError ? '连接中断' : attempt.record?.error ? '未完整结束' : attempt.settled ? '已完成' : '接收中';
}

function renderInspector() {
  const choice = get<HTMLSelectElement>('record-choice');
  choice.innerHTML = attempts.length ? attempts.map((attempt, index) => `<option value="${index}">第 ${index + 1} 次 · ${CONDITIONS[attempt.condition].label}</option>`).join('') : '<option value="">尚无记录</option>';
  choice.value = String(selected);
  const attempt = attempts[selected];
  if (!attempt) return;
  const record = attempt.record;
  const container = get('record-content');
  container.innerHTML = `<p class="meta">${attempt.transportError ? escape(attempt.transportError) : record?.error ? escape(record.error.message) : !attempt.settled ? '正在接收；完整 SSE 记录在本次结束后显示。' : '已收到完整记录。'}</p>`;
  if (!record) return;
  const meta = document.createElement('p'); meta.className = 'meta';
  meta.textContent = `HTTP ${record.httpStatus ?? '等待中'} · 实际模型 ${record.responseModel ?? '未提供'} · finish_reason=${record.finishReason ?? '未提供'} · 结束方式=${record.endedBy ?? '未结束'} · ${record.startedAt}`;
  container.append(meta);
  const parts = [
    ['实际回答', record.answer],
    ['实际发送给 fetch 的请求体', record.requestBody],
    ['原始 usage', JSON.stringify(record.usage, null, 2)],
    ['SSE 数据事件与后端接收相对时间（毫秒）', JSON.stringify(record.events, null, 2)],
  ];
  for (const [title, text] of parts) {
    const detail = document.createElement('details'); detail.className = 'json';
    const summary = document.createElement('summary'); summary.textContent = title;
    const pre = document.createElement('pre'); pre.textContent = text;
    detail.append(summary, pre); container.append(detail);
  }
}

async function run(condition: Condition) {
  if (running) return;
  running = true;
  const attempt: Attempt = { condition, settled: false }; attempts.push(attempt); selected = attempts.length - 1;
  const status = get('status'); status.className = ''; status.textContent = `${CONDITIONS[condition].label}：正在发起一次真实模型调用。`;
  renderTable(); renderAnswer(attempt); renderInspector();
  let receivedComplete = false;
  try {
    const response = await fetch('/api/latency/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ condition }) });
    if (!response.ok) {
      const data = await response.json() as { error?: string };
      throw new Error(data.error || '本机服务未能启动本次调用。');
    }
    if (!response.body) throw new Error('没有收到可读取的事件流。');
    for await (const event of readEvents(response.body)) {
      const data = JSON.parse(event.data) as ClientEvent;
      if (data.type === 'start') attempt.record = data.record;
      else if (data.type === 'delta' && attempt.record) {
        attempt.record.answer += data.text; attempt.record.firstContentMs ??= data.elapsedMs;
      } else if (data.type === 'complete') { attempt.record = data.record; receivedComplete = true; }
      renderAnswer(attempt); renderTable();
    }
    if (!receivedComplete) throw new Error('本机事件连接提前结束；已收到的正文保留，完整用量和事件记录未取得。');
    status.textContent = attempt.record?.error?.message || `${CONDITIONS[condition].label}已结束。可继续下一项，或展开本次记录。`;
    if (attempt.record?.error) status.className = 'error';
  } catch (error) {
    attempt.transportError = error instanceof Error ? error.message : '连接失败，已有记录保留，没有自动重试。';
    status.textContent = attempt.transportError; status.className = 'error';
  } finally {
    attempt.settled = true; running = false;
    renderTable(); renderAnswer(attempt); renderInspector(); get<HTMLButtonElement>('download').disabled = false;
  }
}

get('comparison-body').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-run]');
  if (button) void run(button.dataset.run as Condition);
});
get('record-choice').addEventListener('change', () => { selected = Number(get<HTMLSelectElement>('record-choice').value); renderInspector(); if (!running) renderAnswer(attempts[selected]); });
get('download').addEventListener('click', () => {
  const payload = { question: QUESTION, runs: attempts.map((attempt) => ({ condition: attempt.condition, settled: attempt.settled, transportError: attempt.transportError ?? null, record: attempt.record ?? null })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = '流式等待-实际请求记录.json'; anchor.click(); URL.revokeObjectURL(url);
});
get<HTMLDetailsElement>('materials').addEventListener('toggle', async () => {
  if (!get<HTMLDetailsElement>('materials').open || get('materials-content').dataset.loaded) return;
  try {
    const response = await fetch('/api/latency/materials');
    if (!response.ok) throw new Error();
    const data = await response.json() as { short: string; long: string };
    get('materials-content').textContent = `短材料\n${data.short}\n\n完整长材料\n${data.long}`;
    get('materials-content').dataset.loaded = 'true';
  } catch { get('materials-content').textContent = '材料读取失败，请检查本机服务后重新展开。'; }
});
renderTable();
