import './style.css';
import '../lab.css';
import { FACTS, GOAL } from './scenario.ts';
import { chooseOption, clearSelection, editDraft, emptyDecision, type Decision, type DecisionRun, type DecisionResponse, type OptionIndex } from './contract.ts';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `<header><a href="/">请求观察室</a><span class="eyebrow">人的判断 · 文案对比</span>
  <h1>文案对比与选择</h1><p>对照同一资料与目标，比较文案的取舍，再选择和修改。</p></header>
  <section class="common"><div><h2>活动资料 · 教学虚构</h2><ul id="facts"></ul></div><div><h2>共同目标</h2><p id="goal"></p></div></section>
  <div class="generate-bar"><button id="generate">生成两份候选文案</button><p class="note">调用模型 1 次。</p></div>
  <p id="status" role="status" aria-live="polite"></p>
  <div id="run-picker" hidden><label for="run-choice">查看本页记录 </label><select id="run-choice"></select></div>
  <section id="comparison" hidden><div class="section-heading"><h2>两份模型原稿</h2><button id="reject" class="secondary">两份都不采用</button></div>
    <p class="note">理由、取舍和待确认项均为模型建议，需自行核对。</p><div id="options" class="options"></div>
    <p id="decision-state" class="decision-state" role="status"></p>
  </section>
  <section id="editor" hidden><div class="section-heading"><h2>本地待编辑稿</h2><button id="clear" class="secondary">放弃当前选择</button></div>
    <p class="note">修改只保存在本页，不调用模型或对外发布。</p>
    <label for="draft-title">标题</label><input id="draft-title" type="text" />
    <label for="draft-text">介绍正文</label><textarea id="draft-text" rows="6"></textarea>
  </section>
  <div class="export-bar"><button id="download" class="secondary" disabled>导出本次判断记录</button><span class="note">刷新前导出，保留尝试、选择和编辑稿。</span></div>
  <details id="inspector"><summary>请求明细与用量</summary><div id="request-content" class="inspector-body"><p class="note">尚未调用模型。</p></div></details>`;

const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
for (const fact of FACTS) { const item = document.createElement('li'); item.textContent = fact; get('facts').append(item); }
get('goal').textContent = GOAL;
type Work = { run: DecisionRun | null; transportError: string | null; decision: Decision };
const works: Work[] = [];
let current = -1;
let busy = false;
const paragraph = (text: string, className = '') => { const p = document.createElement('p'); p.textContent = text; p.className = className; return p; };

function renderDecision() {
  const decision = works[current]?.decision;
  if (!decision) return;
  const editing = decision.status === 'editing' && decision.selected !== null;
  get('editor').hidden = !editing;
  get('decision-state').textContent = editing ? `已选择${decision.selected === 0 ? '信息优先' : '参与感优先'}作为基础，当前为本地待编辑稿。`
    : decision.status === 'rejected' ? '两份都不采用。模型原稿和本页已有编辑仍保留。' : '尚未选择。可以选一份作为基础，也可以两份都不采用。';
  for (const button of get('options').querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(editing && Number(button.dataset.option) === decision.selected));
  if (editing) {
    const draft = decision.drafts[decision.selected!]!;
    get<HTMLInputElement>('draft-title').value = draft.title; get<HTMLTextAreaElement>('draft-text').value = draft.text;
  }
}

function render() {
  const work = works[current];
  const error = work?.transportError || work?.run?.error?.message;
  const status = get('status');
  status.className = !busy && error ? 'error' : '';
  status.textContent = busy ? '正在根据同一资料与目标生成两份文案…' : error
    || (work?.run?.options ? '两份文案已生成。先对照给定资料，再决定怎样处理。' : '');
  get('run-picker').hidden = works.length < 2;
  const select = get<HTMLSelectElement>('run-choice'); select.replaceChildren(...works.map((item, index) => new Option(`第${index + 1}次生成${item.run?.error || item.transportError ? ' · 未完成' : ''}`, String(index))));
  select.value = String(current); select.disabled = busy;
  get('comparison').hidden = !work?.run?.options; get('editor').hidden = true;
  const options = get('options'); options.replaceChildren();
  if (work?.run?.options) {
    for (const [index, option] of work.run.options.entries()) {
      const section = document.createElement('section'); section.className = 'option';
      const heading = document.createElement('h3'); heading.textContent = option.direction;
      const title = document.createElement('h4'); title.textContent = option.title;
      section.append(heading, title, paragraph(option.text, 'copy'));
      const list = document.createElement('dl');
      for (const [label, text] of [['采用理由', option.reason], ['取舍', option.tradeoff], ['待确认', option.unknowns]]) {
        const term = document.createElement('dt'); term.textContent = label;
        const description = document.createElement('dd'); description.textContent = text; list.append(term, description);
      }
      const button = document.createElement('button'); button.textContent = '以这版为基础'; button.dataset.option = String(index);
      section.append(list, button); options.append(section);
    }
    renderDecision();
  }
  const content = get('request-content'); content.replaceChildren();
  if (!work) return;
  if (work.transportError || work.run?.error) content.append(paragraph(work.transportError || work.run!.error!.message, 'error'));
  const request = work.run?.request;
  if (request) {
    content.append(paragraph(`HTTP ${request.httpStatus ?? '未返回'} · 模型 ${request.responseModel ?? '未返回'} · finish_reason=${request.finishReason ?? '未返回'}`, 'meta'));
    for (const [label, text] of [['实际请求体', request.requestBody], ['原始响应消息', JSON.stringify(request.responseMessage ?? null, null, 2)], ['实际 usage', JSON.stringify(request.usage ?? null, null, 2)]]) {
      const detail = document.createElement('details'); detail.className = 'json';
      const summary = document.createElement('summary'); summary.textContent = label;
      const pre = document.createElement('pre'); pre.textContent = text; detail.append(summary, pre); content.append(detail);
    }
  } else content.append(paragraph(busy ? '正在等待模型。' : '没有取得实际请求记录。', 'note'));
}

get('generate').addEventListener('click', async () => {
  if (busy) return;
  busy = true; const work: Work = { run: null, transportError: null, decision: emptyDecision() }; works.push(work); current = works.length - 1;
  get<HTMLButtonElement>('generate').disabled = true;
  render();
  try {
    const response = await fetch('/api/decisions/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await response.json() as DecisionResponse;
    if (!data.run) throw new Error('没有收到可读取的实验记录。');
    work.run = data.run;
  } catch (error) {
    work.transportError = error instanceof Error ? error.message : '本机连接中断，没有自动重试。';
  } finally {
    busy = false; get<HTMLButtonElement>('generate').disabled = false; get('generate').textContent = '再生成两份文案'; get('generate').className = 'secondary';
    get<HTMLButtonElement>('download').disabled = false; render();
  }
});
get('options').addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-option]');
  const work = works[current]; if (!button || !work?.run?.options) return;
  work.decision = chooseOption(work.decision, work.run.options, Number(button.dataset.option) as OptionIndex); renderDecision();
});
get('reject').addEventListener('click', () => { const work = works[current]; work.decision = clearSelection(work.decision, true); renderDecision(); });
get('clear').addEventListener('click', () => { const work = works[current]; work.decision = clearSelection(work.decision, false); renderDecision(); });
for (const [id, field] of [['draft-title', 'title'], ['draft-text', 'text']] as const) get(id).addEventListener('input', () => {
  const work = works[current]; work.decision = editDraft(work.decision, field, get<HTMLInputElement | HTMLTextAreaElement>(id).value);
});
get('run-choice').addEventListener('change', () => { current = Number(get<HTMLSelectElement>('run-choice').value); render(); });
get('download').addEventListener('click', () => {
  const payload = { facts: FACTS, goal: GOAL, currentRun: current, runs: works.map((work) => ({ ...work,
    currentDraft: work.decision.selected === null ? null : work.decision.drafts[work.decision.selected] })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = '文案判断-实际请求与编辑记录.json'; link.click(); URL.revokeObjectURL(url);
});
