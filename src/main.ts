import './style.css';
import type { AskResult } from './contract.ts';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header><span class="eyebrow">进阶 vibe coding · 01</span><h1>请求观察室</h1><p>提一个问题，看看回答从哪里来。</p></header>
  <section class="workspace">
    <form id="question-form">
      <label for="question">我们想问什么？</label>
      <textarea id="question" rows="4" maxlength="2000" required placeholder="例如：用两句话解释，为什么浏览器页面里不应该放 API 密钥？"></textarea>
      <div class="actions"><span id="status" role="status">每次发送都是一次独立提问。</span><button type="submit">发送问题 <span aria-hidden="true">↗</span></button></div>
    </form>
    <section class="response" aria-labelledby="answer-heading"><h2 id="answer-heading">模型的回答</h2><p id="answer" class="empty">发送后，回答会显示在这里。</p></section>
  </section>`;

const form = document.querySelector<HTMLFormElement>('#question-form')!;
const questionInput = document.querySelector<HTMLTextAreaElement>('#question')!;
const button = form.querySelector<HTMLButtonElement>('button')!;
const status = document.querySelector<HTMLSpanElement>('#status')!;
const answer = document.querySelector<HTMLParagraphElement>('#answer')!;

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
  try {
    const response = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    const result: AskResult = await response.json();
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
  } finally {
    button.disabled = false;
    questionInput.disabled = false;
  }
});
