import './style.css';
import '../lab.css';
import { FACTS, INITIAL_TASK } from './scenario.ts';
import { acceptTurn, type Turn, type CollaborationResponse, type CollaborationResult } from './contract.ts';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `<header><a href="/">请求观察室</a><span class="eyebrow">人在环路 · 文字共写</span>
  <h1>活动共写</h1><p>比较两个方向，提出选择或纠正，再看 AI 怎样改写。</p></header>
  <section class="facts"><h2>已有活动资料 · 教学虚构</h2><p id="facts"></p></section>
  <section id="conversation" hidden><div class="section-heading"><h2>共写记录</h2><button id="copy" class="secondary" type="button">复制最新回答</button></div><div id="turns"></div></section>
  <form id="compose"><label id="input-label" for="input">本轮要求</label>
    <textarea id="input" rows="5" maxlength="6000" required></textarea>
    <div class="compose-actions"><p class="note">每次提交调用模型 1 次。</p><button id="send" type="submit">生成两个方向</button></div>
  </form>
  <p id="status" role="status" aria-live="polite"></p>
  <div class="record-bar"><button id="download" class="secondary" disabled>下载共写记录</button><span class="note">刷新前下载，保留全部尝试。</span></div>
  <details id="inspector"><summary>请求明细与用量</summary><div class="inspector-body">
    <label for="record-choice">选择尝试 </label><select id="record-choice"><option value="">尚无记录</option></select><div id="record-content"></div>
  </div></details>`;

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
element('facts').textContent = FACTS;
element<HTMLTextAreaElement>('input').value = INITIAL_TASK;
type Attempt = { input: string; priorSuccessfulTurns: number; startedAt: string; result: CollaborationResult | null; transportError: string | null };
const attempts: Attempt[] = [];
let history: Turn[] = [];
let busy = false;
let selected = -1;

function paragraph(text: string, className = '') {
  const p = document.createElement('p'); p.textContent = text; p.className = className; return p;
}

function renderHistory() {
  element('conversation').hidden = !history.length;
  const container = element('turns'); container.replaceChildren();
  for (const [index, turn] of history.entries()) {
    const latest = index === history.length - 1;
    const block = document.createElement(latest ? 'section' : 'details');
    block.className = latest ? 'latest-turn' : 'previous-turn';
    const label = document.createElement(latest ? 'h3' : 'summary'); label.textContent = `第 ${index + 1} 轮${latest ? ' · 最新回答' : ''}`;
    const content = document.createElement('div'); content.className = 'turn-body';
    content.append(paragraph('我们的任务或反馈', 'small-label'), paragraph(turn.input, 'human-input'), paragraph('AI 原始回答', 'small-label'), paragraph(turn.answer, 'answer'));
    block.append(label, content); container.append(block);
  }
}

function renderInspector() {
  const select = element<HTMLSelectElement>('record-choice');
  select.replaceChildren(...attempts.map((attempt, index) => new Option(`尝试 ${index + 1} · 第 ${attempt.priorSuccessfulTurns + 1} 轮`, String(index))));
  select.value = String(selected);
  const container = element('record-content'); container.replaceChildren();
  const attempt = attempts[selected]; if (!attempt) return;
  container.append(paragraph(attempt.transportError || attempt.result?.error?.message || (attempt.result?.answer !== null && attempt.result ? '本轮已加入成功对话。' : '正在等待本轮结果。'), 'meta'));
  container.append(paragraph(`本次输入：${attempt.input}`, 'human-input'));
  if (!attempt.result) return;
  const request = attempt.result.request;
  if (!request) { container.append(paragraph('未发起模型请求。', 'note')); return; }
  container.append(paragraph(`HTTP ${request.httpStatus ?? '未返回'} · 模型 ${request.responseModel ?? '未返回'} · finish_reason=${request.finishReason ?? '未返回'} · ${request.durationMs ?? '—'} ms`, 'meta'));
  for (const [title, text] of [
    ['实际发送的完整请求体', request.requestBody],
    ['原始响应消息', JSON.stringify(request.responseMessage ?? null, null, 2)],
    ['实际 usage', JSON.stringify(request.usage ?? null, null, 2)],
  ]) {
    const detail = document.createElement('details'); detail.className = 'json';
    const summary = document.createElement('summary'); summary.textContent = title;
    const pre = document.createElement('pre'); pre.textContent = text;
    detail.append(summary, pre); container.append(detail);
  }
}

element<HTMLFormElement>('compose').addEventListener('submit', async (event) => {
  event.preventDefault(); if (busy) return;
  const input = element<HTMLTextAreaElement>('input'); if (!input.value.trim()) return;
  const attempt: Attempt = { input: input.value, priorSuccessfulTurns: history.length, startedAt: new Date().toISOString(), result: null, transportError: null };
  attempts.push(attempt); selected = attempts.length - 1; busy = true;
  element<HTMLButtonElement>('send').disabled = true; input.disabled = true;
  const status = element('status'); status.className = ''; status.textContent = 'AI 正在根据我们的任务与完整对话继续共写…'; renderInspector();
  try {
    const response = await fetch('/api/collaboration/turn', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: attempt.input, history }),
    });
    const data = await response.json() as CollaborationResponse | { error: string };
    if (!('result' in data)) throw new Error(data.error);
    attempt.result = data.result;
    if (!data.ok || data.result.error) {
      status.textContent = data.result.error?.message || '本轮没有完成；输入保留，未加入成功对话。'; status.className = 'error';
    } else {
      history = acceptTurn(history, data.result);
      input.value = ''; input.placeholder = '写下我们选择什么、为什么这样选，以及需要补充或纠正的地方。';
      element('input-label').textContent = '下一轮反馈'; element('send').textContent = '发送反馈';
      status.textContent = '回答已保留。我们可以继续提出选择、补充或纠正。'; renderHistory();
    }
  } catch (error) {
    attempt.transportError = error instanceof Error ? error.message : '连接未完成。';
    status.textContent = `${attempt.transportError} 输入和已有成功对话保留，没有自动重试。`; status.className = 'error';
  } finally {
    busy = false; input.disabled = false; element<HTMLButtonElement>('send').disabled = false;
    element<HTMLButtonElement>('download').disabled = false; renderInspector();
  }
});
element('record-choice').addEventListener('change', () => { selected = Number(element<HTMLSelectElement>('record-choice').value); renderInspector(); });
element('copy').addEventListener('click', async () => {
  const latest = history.at(-1); if (!latest) return;
  try { await navigator.clipboard.writeText(latest.answer); element('status').className = ''; element('status').textContent = '已复制最新回答。'; }
  catch { element('status').textContent = '浏览器未允许复制，请直接选择回答文字复制。'; }
});
element('download').addEventListener('click', () => {
  const data = { activityFacts: FACTS, successfulHistory: history, attempts };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = '活动共写-实际请求记录.json'; link.click(); URL.revokeObjectURL(url);
});
