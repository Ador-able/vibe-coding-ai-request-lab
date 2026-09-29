import './style.css';
import './lab.css';
import type { AskResult, RequestTrace } from './contract.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><span class="eyebrow">AI 实验</span><h1>请求观察室</h1><p>提一个问题，看看回答从哪里来。</p></header>
  <section class="workspace">
    <form id="question-form">
      <label for="question">问题</label>
      <textarea id="question" rows="4" maxlength="2000" required placeholder="例如：用两句话解释，为什么浏览器页面里不应该放 API 密钥？"></textarea>
      <div class="actions"><span id="status" role="status">每次发送都是一次独立提问。</span><button type="submit">发送问题 <span aria-hidden="true">↗</span></button></div>
    </form>
    <section class="response" aria-labelledby="answer-heading"><h2 id="answer-heading">模型的回答</h2><p id="answer" class="empty">发送后，回答会显示在这里。</p></section>
  </section>
  <details id="request-details" hidden>
    <summary>查看这次请求</summary>
    <div class="trace-content">
      <div class="request-payload"><h2>页面实际发送的数据</h2><p class="endpoint">POST /api/ask</p><pre id="request-body"></pre></div>
      <div class="server-trace"><h2>后端实际经过的步骤</h2><p id="trace-description" class="trace-description"></p><ol id="stages"></ol><dl id="trace-meta"></dl></div>
    </div>
  </details>`;

const form = document.querySelector<HTMLFormElement>('#question-form')!;
const questionInput = document.querySelector<HTMLTextAreaElement>('#question')!;
const button = form.querySelector<HTMLButtonElement>('button')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const answer = document.querySelector<HTMLParagraphElement>('#answer')!;
const details = document.querySelector<HTMLDetailsElement>('#request-details')!;
const requestBody = document.querySelector<HTMLPreElement>('#request-body')!;
const stages = document.querySelector<HTMLOListElement>('#stages')!;
const metadata = document.querySelector<HTMLDListElement>('#trace-meta')!;
const description = document.querySelector<HTMLParagraphElement>('#trace-description')!;

function showTrace(trace: RequestTrace, httpStatus: number, browserMs: number) {
  description.textContent = '时间从后端收到请求起累计；只列出实际发生的步骤。';
  stages.replaceChildren(...trace.stages.map((stage) => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = stage.name;
    const time = document.createElement('span');
    time.className = 'stage-time';
    time.textContent = `${stage.elapsedMs} ms`;
    const detail = document.createElement('p');
    detail.textContent = stage.detail;
    item.append(name, time, detail);
    return item;
  }));
  const entries: [string, string][] = [
    ['请求编号', trace.requestId],
    ['请求的模型', trace.model ?? '尚未调用'],
    ['后端返回', `HTTP ${httpStatus}`],
    ['页面等待', `${browserMs} ms`],
  ];
  if (trace.modelDurationMs !== undefined) entries.push(['模型调用耗时', `${trace.modelDurationMs} ms`]);
  metadata.replaceChildren(...entries.flatMap(([label, value]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const content = document.createElement('dd');
    content.textContent = value;
    return [term, content];
  }));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question || button.disabled) return;
  button.disabled = true;
  questionInput.disabled = true;
  answer.textContent = '';
  answer.className = '';
  status.textContent = '正在等待模型回复……';
  status.className = '';
  const body = JSON.stringify({ question });
  details.hidden = false;
  requestBody.textContent = JSON.stringify(JSON.parse(body), null, 2);
  description.textContent = '等待后端返回记录……';
  stages.replaceChildren();
  metadata.replaceChildren();
  const beganAt = performance.now();
  try {
    const response = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const result: AskResult = await response.json();
    showTrace(result.trace, response.status, Math.round(performance.now() - beganAt));
    if (!result.ok) {
      status.textContent = result.error.message;
      status.className = 'error';
      answer.textContent = '本次没有生成回答。';
      answer.className = 'empty';
      return;
    }
    answer.textContent = result.answer;
    status.textContent = '已收到模型回答。';
  } catch {
    status.textContent = '未收到后端的有效回复，请确认本地服务正在运行。';
    status.className = 'error';
    answer.textContent = '本次没有生成回答。';
    answer.className = 'empty';
    description.textContent = '没有收到有效的后端记录，无法判断模型是否完成调用。';
  } finally {
    button.disabled = false;
    questionInput.disabled = false;
  }
});
