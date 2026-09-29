import './style.css';
import '../lab.css';
import { CONDITIONS, FIRST_QUESTION, FOLLOW_UP, type Condition, type ContextResponse, type ExperimentRun, type Message, type RequestRecord } from './contract.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><a href="/">请求观察室</a><span class="eyebrow">上下文实验</span>
    <h1>上下文对照</h1>
    <p>同一个追问，比较只带问题、聊天文字和完整工具结果时的回答。</p>
  </header>
  <details id="setup" class="setup" open>
    <summary id="setup-title">首轮查询</summary><div class="setup-body">
    <p class="question" id="first-question"></p>
    <div class="setup-actions"><button id="start">查询发布时间</button><span class="experiment-note">教学虚构资料 · 首轮调用模型 2 次</span></div>
    <div id="first-answer-wrap" hidden><span class="small-label">首轮回答 · 原文</span><p id="first-answer" class="answer"></p><p class="note">三种追问条件共享这一次首轮历史。</p></div>
  </div></details>
  <p id="status" role="status"></p>
  <section id="follow-section" hidden aria-labelledby="follow-question">
    <p class="question"><span class="question-label">追问</span><span id="follow-question"></span></p>
    <fieldset id="conditions"><legend>携带的历史</legend>
      ${Object.entries(CONDITIONS).map(([key, value], i) => `<label class="condition"><input type="radio" name="condition" value="${key}" ${i === 0 ? 'checked' : ''}><span><strong>${value.name}</strong><small>${value.description}</small></span></label>`).join('')}
    </fieldset>
    <div class="follow-actions"><button id="follow">发送追问</button><span class="experiment-note">每次调用模型 1 次；不重新查询工具</span></div>
    <section id="comparison" hidden aria-labelledby="comparison-title"><h3 id="comparison-title">实际返回的回答</h3>
      <div class="table-scroll"><table><thead><tr><th>保留范围</th><th>模型回答</th><th>输入 token</th><th>请求记录</th></tr></thead><tbody id="results"></tbody></table></div>
    </section>
  </section>
  <details id="inspector" hidden><summary>请求明细与下载</summary><div class="inspector-body">
    <div class="inspector-tools"><label for="run-selector">选择记录</label><select id="run-selector"></select><button id="download" class="secondary">下载本页记录</button></div>
    <p class="note">JSON 来自实际交给 fetch 的请求体；不含请求头、API 密钥或服务地址。模型返回和本地工具结果分别列出。</p>
    <div id="records"></div>
  </div></details>
  <details class="guide"><summary>实验条件与信息说明</summary><div class="guide-body"><p>三种条件都附有系统规则和工具定义，以 tool_choice: none 禁止重新查询。每次追问共享同一份首轮记录，不携带上次追问的回答；表格保留模型原文。</p><dl>
    <dt>系统规则</dt><dd>规定回答方式：依据信息、缺少证据就说明，不猜测。</dd>
    <dt>用户消息</dt><dd>提出本轮任务。本实验只有版本问题，没有额外附加材料。</dd>
    <dt>聊天历史</dt><dd>保留之前说过什么；助手文字不一定包含工具查到的全部内容。</dd>
    <dt>工具定义</dt><dd>描述能查询什么、需要什么参数，本身不包含查询结果。</dd>
    <dt>工具调用与结果</dt><dd>助手发出调用，程序执行后返回资料，两条消息用调用编号配对。</dd>
    </dl><p>本实验只比较请求携带的信息，不测模型的长期记忆。历史在本机服务内存中；刷新页面需重新建立首轮，停止服务后历史清空。温度固定为 0，实际回答仍不保证完全复现。</p></div></details>`;

const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const startButton = element<HTMLButtonElement>('#start');
const followButton = element<HTMLButtonElement>('#follow');
const status = element<HTMLParagraphElement>('#status');
const inspector = element<HTMLDetailsElement>('#inspector');
const runSelector = element<HTMLSelectElement>('#run-selector');
const records = element<HTMLDivElement>('#records');
const setup = element<HTMLDetailsElement>('#setup');
element('#first-question').textContent = FIRST_QUESTION;
element('#follow-question').textContent = FOLLOW_UP;
let sessionId: string | undefined;
let firstRound: ExperimentRun | undefined;
let runs: ExperimentRun[] = [];
let busy = false;

function setBusy(value: boolean) {
  busy = value;
  startButton.disabled = value;
  followButton.disabled = value;
  element<HTMLFieldSetElement>('#conditions').disabled = value;
}

function paragraph(text: string, className = '') {
  const node = document.createElement('p'); node.textContent = text; node.className = className; return node;
}

function pretty(value: unknown) { return JSON.stringify(value, null, 2) ?? '未返回'; }

function jsonDetail(title: string, value: string, open = false) {
  const detail = document.createElement('details'); detail.className = 'json'; detail.open = open;
  const summary = document.createElement('summary'); summary.textContent = title;
  const pre = document.createElement('pre'); pre.textContent = value;
  detail.append(summary, pre); return detail;
}

function requestView(request: RequestRecord, index: number) {
  const section = document.createElement('section'); section.className = 'request-record';
  const heading = document.createElement('h3'); heading.textContent = `请求 ${index + 1} · ${request.step}`;
  const body = JSON.parse(request.requestBody) as { model: string; messages: Message[]; tools: unknown[]; tool_choice: unknown };
  section.append(heading, paragraph(`请求型号 ${body.model} · ${request.httpStatus ? `HTTP ${request.httpStatus}` : '未收到 HTTP 响应'} · ${request.durationMs ?? '—'} ms`, 'meta'));
  const sequence = document.createElement('div'); sequence.className = 'message-sequence'; sequence.setAttribute('aria-label', '本次请求的消息顺序');
  const names = { system: '系统规则', user: '用户消息', assistant: '助手文字', tool: '工具结果' };
  body.messages.forEach((message, i) => {
    const chip = document.createElement('span'); chip.className = `message ${message.role}`;
    chip.textContent = `${i + 1} ${message.role === 'assistant' && message.tool_calls?.length ? '助手工具调用' : names[message.role]}`;
    sequence.append(chip);
  });
  section.append(sequence, paragraph(`另附 ${body.tools.length} 个工具定义 · tool_choice: ${typeof body.tool_choice === 'string' ? body.tool_choice : '指定 get_release_info'}`, 'meta'));
  // 排版只解析这个已发送字符串；下载文件保留 requestBody 的原始字节序列。
  section.append(jsonDetail('请求体 · 格式化显示', pretty(body)));
  if (request.responseMessage !== undefined) section.append(jsonDetail('模型实际返回的消息', pretty(request.responseMessage)));
  section.append(paragraph(`finish_reason: ${request.finishReason ?? '未返回'}${request.responseModel ? ` · 返回型号：${request.responseModel}` : ''}`, 'meta'));
  section.append(jsonDetail('模型实际返回的 usage', pretty(request.usage ?? null)));
  if (request.error) section.append(paragraph(request.error, 'error'));
  return section;
}

function allRuns() { return [...(firstRound ? [firstRound] : []), ...runs]; }

function renderInspector(selectedId?: string) {
  const items = allRuns(); inspector.hidden = !items.length;
  runSelector.replaceChildren(...items.map((run, index) => {
    const option = document.createElement('option'); option.value = run.id;
    option.textContent = `${index + 1}. ${run.label}${run.error ? '（未完成）' : ''}`; return option;
  }));
  runSelector.value = selectedId ?? items.at(-1)?.id ?? '';
  showRecord();
}

function showRecord() {
  const selected = allRuns().find((item) => item.id === runSelector.value);
  records.replaceChildren(); if (!selected) return;
  records.append(paragraph(`本机记录 ${selected.id} · ${selected.startedAt}`, 'meta'));
  if (selected.error) records.append(paragraph(selected.error.message, 'error'));
  if (!selected.requests.length) records.append(paragraph('本轮没有发起模型请求。', 'note'));
  records.append(...selected.requests.map(requestView));
  if (selected.tools.length) records.append(jsonDetail('本机实际执行的工具及返回结果', pretty(selected.tools)));
}

function renderResults() {
  element('#comparison').hidden = !runs.some((run) => run.condition);
  element('#results').replaceChildren(...runs.filter((run) => run.condition).map((run) => {
    const row = document.createElement('tr');
    const request = run.requests[0];
    const usage = request?.usage;
    const inputTokens = usage && typeof usage === 'object' && 'prompt_tokens' in usage && typeof usage.prompt_tokens === 'number' ? String(usage.prompt_tokens) : '未返回';
    const values = [run.label, run.error ? `未完成：${run.error.message}` : run.answer ?? '没有回答', inputTokens];
    values.forEach((value, index) => { const cell = document.createElement('td'); cell.textContent = value; if (index === 1) cell.className = 'answer-cell'; row.append(cell); });
    const cell = document.createElement('td'); const button = document.createElement('button'); button.className = 'link-button'; button.textContent = '查看';
    button.addEventListener('click', () => { runSelector.value = run.id; showRecord(); inspector.open = true; inspector.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    cell.append(button); row.append(cell); return row;
  }));
}

async function send(path: string, body: unknown): Promise<ContextResponse> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data: ContextResponse = await response.json();
  if (!data.run || !Array.isArray(data.run.requests)) throw new Error('invalid-response');
  return data;
}

startButton.addEventListener('click', async () => {
  if (busy) return; setBusy(true);
  sessionId = undefined; firstRound = undefined; runs = [];
  setup.open = true; element('#setup-title').textContent = '首轮查询';
  element('#follow-section').hidden = true; element('#first-answer-wrap').hidden = true;
  inspector.hidden = true; status.className = ''; status.textContent = '正在建立首轮：请求工具、执行查询，再请模型回答……';
  try {
    const result = await send('/api/context/start', {});
    firstRound = result.run; renderInspector();
    if (!result.ok) { status.textContent = result.run.error?.message ?? '首轮未能完成。'; status.className = 'error'; return; }
    sessionId = result.sessionId;
    element('#first-answer').textContent = result.run.answer;
    element('#first-answer-wrap').hidden = false; element('#follow-section').hidden = false;
    setup.open = false; element('#setup-title').textContent = '首轮查询已完成 · 查看回答或重新查询';
    startButton.textContent = '重新查询'; startButton.classList.add('secondary'); renderResults();
    status.textContent = '';
  } catch { status.textContent = '没有收到本机服务的有效回复，请确认服务仍在运行。'; status.className = 'error'; }
  finally { setBusy(false); }
});

followButton.addEventListener('click', async () => {
  if (busy || !sessionId) return;
  const condition = element<HTMLInputElement>('input[name="condition"]:checked').value as Condition;
  setBusy(true); status.className = ''; status.textContent = `正在发送追问：${CONDITIONS[condition].name}……`;
  try {
    const result = await send('/api/context/follow-up', { sessionId, condition });
    // 每次运行都保留，不用预设答案替换模型返回，也不覆盖此前结果。
    runs.push(result.run); renderInspector(result.run.id); renderResults();
    status.textContent = result.ok ? '' : result.run.error?.message ?? '本次追问未完成。';
    status.className = result.ok ? '' : 'error';
  } catch { status.textContent = '没有收到本机服务的有效回复；本轮结果未知，请确认服务状态。'; status.className = 'error'; }
  finally { setBusy(false); }
});

runSelector.addEventListener('change', showRecord);
element('#download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([pretty({ sessionId, firstRound, runs })], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = '上下文实验-实际请求记录.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
