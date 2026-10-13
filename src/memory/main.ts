import './style.css';
import '../lab.css';
import { markdown } from '../markdown.ts';
import { FLOWS, costOf, type Flow, type FlowResponse, type FlowResult, type SavedNote } from './contract.ts';
import type { Source, TEACHING_NOTE } from './materials.ts';

document.querySelector('#app')!.innerHTML = `
  <header><h1>材料与记忆</h1><p>比较小说资料的三种读法，再用核对后的摘要接续写作。</p></header>
  <p id="load-status" role="status">正在载入资料……</p>
  <div class="experiment-tabs" role="tablist" aria-label="实验内容">
    <button id="compare-tab" role="tab" aria-controls="compare-panel" aria-selected="true">比较资料</button>
    <button id="memory-tab" role="tab" aria-controls="memory-panel" aria-selected="false" tabindex="-1">跨会话接续</button>
  </div>
  <section id="compare-panel" role="tabpanel" aria-labelledby="compare-tab">
    <p id="question" class="question"></p>
    <div class="primary-actions"><button id="start" disabled>比较三条流程</button><span class="note">每次比较调用模型 5 次</span></div>
    <details class="reading"><summary>查看资料目录与原文</summary><p class="note">《青岚修仙录》· 10 份本实验教学资料。</p><div id="catalog"></div></details>
    <p id="status" role="status"></p>
    <div id="results" class="comparison-results"></div>
  </section>
  <section id="memory-panel" role="tabpanel" aria-labelledby="memory-tab" hidden>
    <p class="section-intro">这份人工整理的摘要接续同一段小说。核对并保存后，新会话会读入摘要和关联原文。</p>
    <div id="teaching-note"></div>
    <div id="save-step"><label class="confirm"><input id="confirm" type="checkbox">我已核对摘要中的条件、待确认事项和来源。</label><button id="save" disabled>保存摘要</button></div>
    <div class="primary-actions" id="resume-step" hidden><button id="resume" disabled>开始新会话</button><span class="note">调用模型 1 次</span></div>
    <p id="note-status" class="note" role="status"></p><div id="note-results"></div>
  </section>
  <footer class="download-bar"><button id="download" class="secondary" disabled>下载全部请求记录</button></footer>`;

const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const start = el<HTMLButtonElement>('#start'), save = el<HTMLButtonElement>('#save'), resume = el<HTMLButtonElement>('#resume');
const status = el('#status'), noteStatus = el('#note-status'), confirm = el<HTMLInputElement>('#confirm');
const runs: FlowResult[] = [];
let busy = true, saved: SavedNote | null = null;
let materials: { question: string; sources: Source[]; teachingNote: typeof TEACHING_NOTE };
const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? '未返回';
function p(text: string, className = '') { const item = document.createElement('p'); item.textContent = text; item.className = className; return item; }
function heading(text: string, level: 'h3' | 'h4' = 'h3') { const item = document.createElement(level); item.textContent = text; return item; }
function disclosure(title: string) {
  const box = document.createElement('details');
  const label = document.createElement('summary'); label.textContent = title; box.append(label); return box;
}
function textDetail(title: string, value: string) {
  const box = disclosure(title); const pre = document.createElement('pre'); pre.textContent = value; box.append(pre); return box;
}

const tabs = [el<HTMLButtonElement>('#compare-tab'), el<HTMLButtonElement>('#memory-tab')];
function selectPanel(index: number) {
  tabs.forEach((tab, position) => {
    const selected = position === index; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    el(`#${tab.getAttribute('aria-controls')}`).hidden = !selected;
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => { selectPanel(index); history.replaceState(null, '', index ? '#memory-step' : '#compare-step'); });
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
    tabs[next].focus(); tabs[next].click();
  });
});
selectPanel(location.hash === '#memory-step' ? 1 : 0);
window.addEventListener('hashchange', () => selectPanel(location.hash === '#memory-step' ? 1 : 0));

function setBusy(value: boolean) {
  busy = value; start.disabled = value || !materials; save.disabled = value || !materials || !confirm.checked; resume.disabled = value || !saved;
}
function showSavedState() {
  el('#save-step').hidden = !!saved; el('#resume-step').hidden = !saved;
}
function sourceDetail(id: string) {
  const source = materials.sources.find((item) => item.id === id);
  const box = disclosure(source ? `[${id}] ${source.title}` : `[${id}] 来源缺失`);
  box.className = 'source-detail';
  box.append(source ? p(source.text) : p('资料中没有这个编号，请核对引用。', 'error'));
  if (source) box.append(p(`来源日期：${source.date}`, 'note'));
  return box;
}
function sourceList(ids: string[], title = '核对来源') {
  const box = disclosure(title); box.className = 'source-list';
  ids.forEach((id) => box.append(sourceDetail(id))); return box;
}
function citations(text: string) {
  const ids = [...new Set(text.match(/C\d{2}/g) ?? [])];
  return ids.length ? sourceList(ids) : null;
}
function appendCitations(target: HTMLElement, text: string) {
  const sources = citations(text); if (sources) target.append(sources);
}
function readableMessage(content: string) {
  const box = document.createElement('div');
  // 摘要在实际消息中占一行；只展开已知字段，其余内容保留原文。
  for (const part of content.split(/(\n\{[^\n]+\}\n)/)) {
    try {
      const note = JSON.parse(part) as typeof TEACHING_NOTE;
      if (Object.keys(note).sort().join(',') !== 'confirmed,goal,next_steps,pending,sources') throw new Error('other-content');
      const summary = document.createElement('div'); summary.className = 'input-note';
      summary.append(p(`目标：${note.goal}`));
      for (const [title, items] of [['已确认的事实与条件', note.confirmed], ['仍待确认', note.pending]] as const) {
        const list = document.createElement('ul');
        items.forEach((item) => { const line = document.createElement('li'); line.textContent = `${item.text} ${item.source_ids.map((id) => `[${id}]`).join(' ')}`; list.append(line); });
        summary.append(heading(title, 'h4'), list);
      }
      summary.append(p(`下一步：${note.next_steps.join(' ')}`), p(`来源：${note.sources.map((source) => `${source.id}（${source.date}）`).join('、')}`));
      box.append(summary);
    } catch { if (part.trim()) box.append(p(part, 'input-message')); }
  }
  return box;
}
function requestInputs(result: FlowResult) {
  const box = disclosure('查看本次输入'); box.className = 'request-inputs';
  if (!result.requests.length) { box.append(p('本次尚未发出请求。', 'note')); return box; }
  // 输入直接取自请求记录，避免用页面摘要重建模型看到的内容。
  result.requests.forEach((request, index) => {
    const step = result.requests.length > 1 ? disclosure(`第 ${index + 1} 步：${request.step}`) : document.createElement('div');
    if (step instanceof HTMLDetailsElement) step.open = index === result.requests.length - 1;
    try {
      const body = JSON.parse(request.requestBody) as { messages: { role: string; content: unknown }[] };
      for (const message of body.messages) {
        const labels: Record<string, string> = { system: '任务要求', user: '提供给模型的内容', assistant: '助手消息', tool: '工具结果' };
        step.append(heading(labels[message.role] ?? message.role, 'h4'));
        step.append(typeof message.content === 'string' ? readableMessage(message.content) : p(pretty(message.content), 'input-message'));
      }
    } catch { step.append(p('输入无法展开，请在技术详情中查看原始记录。', 'error')); }
    box.append(step);
  });
  return box;
}
function renderResult(result: FlowResult) {
  const block = document.createElement('article'); block.className = 'flow-result';
  block.append(heading(result.flow === 'note' ? '新会话的回答' : FLOWS[result.flow]));
  if (result.answer) block.append(markdown(result.answer, 'answer'));
  if (result.error) block.append(p(result.error.message, 'error'));
  else if (!result.answer) block.append(p('本次没有完整回答。', 'error'));
  if (result.selectedIds) block.append(sourceList(result.selectedIds, `选中的资料（${result.selectedIds.length} 份）`));
  if (result.summary !== undefined) {
    const summary = disclosure('生成的摘要'); summary.append(markdown(result.summary)); appendCitations(summary, result.summary); block.append(summary);
  }
  if (result.answer) appendCitations(block, result.answer);
  const cost = costOf(result);
  const count = (value: number | null) => value === null ? '未完整返回' : value.toLocaleString('zh-CN');
  block.append(p(`最后回答输入 ${count(cost.finalInput)} · 整条流程输入 ${count(cost.totalInput)} / 输出 ${count(cost.totalOutput)} token`, 'note'));
  if (result.flow === 'note') block.append(p('本次用量只计新会话，未计先前调用与人工核对。', 'note'));
  block.append(requestInputs(result), textDetail('技术详情', pretty({ 用量: cost, 请求: result.requests })));
  return block;
}
async function requestFlow(flow: Flow): Promise<FlowResponse> {
  const response = await fetch('/api/memory/flow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow }) });
  const data: FlowResponse = await response.json();
  if (!data.result || !Array.isArray(data.result.requests)) throw new Error('invalid-response');
  runs.push(data.result);
  // 只更新本次结果，保留其它答案下正在展开的内容。
  const result = renderResult(data.result);
  if (flow === 'note') el('#note-results').replaceChildren(result);
  else el('#results').append(result);
  el<HTMLButtonElement>('#download').disabled = false;
  return data;
}
start.addEventListener('click', async () => {
  if (busy) return; setBusy(true); status.className = ''; el('#results').replaceChildren();
  try {
    for (const [index, flow] of (['full', 'retrieve', 'summary'] as const).entries()) {
      status.textContent = `正在比较 ${index + 1}/3：${FLOWS[flow]}……`;
      const data = await requestFlow(flow);
      if (!data.ok) { status.textContent = '比较已停止。请查看下方错误，已有结果已保留。'; status.className = 'error'; return; }
    }
    status.textContent = '比较完成。核对三份片段是否保留灵草数量、行动限制和未决问题。';
  } catch { status.textContent = '未收到有效结果，执行状态未知。' + (runs.length ? '已有请求记录可下载。' : ''); status.className = 'error'; }
  finally { setBusy(false); start.textContent = '重新比较'; }
});
confirm.addEventListener('change', () => { save.disabled = busy || !materials || !confirm.checked; });
save.addEventListener('click', async () => {
  if (busy || !confirm.checked) return; setBusy(true); noteStatus.className = 'note';
  try {
    const response = await fetch('/api/memory/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    saved = data.saved; showSavedState(); noteStatus.textContent = '摘要已保存到本机。';
  } catch { noteStatus.textContent = '摘要保存失败，请检查本机服务后重试。'; noteStatus.className = 'error'; }
  finally { setBusy(false); }
});
resume.addEventListener('click', async () => {
  if (busy || !saved) return; setBusy(true); noteStatus.className = 'note'; noteStatus.textContent = '正在读入摘要和关联原文……';
  el('#note-results').replaceChildren();
  try {
    const data = await requestFlow('note'); noteStatus.textContent = data.ok ? '新会话已完成。' : '新会话未完成，请查看下方错误。';
    if (!data.ok) noteStatus.className = 'error';
  } catch { noteStatus.textContent = '未收到有效结果，执行状态未知。' + (runs.length ? '已有请求记录可下载。' : ''); noteStatus.className = 'error'; }
  finally { setBusy(false); }
});
el('#download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([pretty({ question: materials.question, runs })], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = '材料与记忆-请求记录.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  const response = await fetch('/api/memory/materials'); if (!response.ok) throw new Error('materials-missing'); materials = await response.json();
  el('#question').textContent = materials.question;
  el('#catalog').replaceChildren(...materials.sources.map((source) => sourceDetail(source.id)));
  const note = materials.teachingNote; const box = el('#teaching-note');
  for (const [title, items] of [['已确认的事实与条件', note.confirmed], ['仍待确认', note.pending]] as const) {
    const list = document.createElement('ul');
    items.forEach((item) => {
      const line = document.createElement('li'); line.textContent = `${item.text} ${item.source_ids.map((id) => `[${id}]`).join(' ')}`; list.append(line);
    });
    box.append(heading(title), list);
  }
  box.append(p(`下一步：${note.next_steps.join(' ')}`), sourceList(note.sources.map((source) => source.id), '核对摘要来源'));
  el('#load-status').textContent = '';
  try {
    const noteResponse = await fetch('/api/memory/note'); const data = await noteResponse.json();
    if (!noteResponse.ok) throw new Error('note-unavailable');
    saved = data.saved; showSavedState(); noteStatus.textContent = saved ? '摘要已保存在本机。' : '';
  } catch { noteStatus.textContent = '本机摘要无法用于本次资料。请核对上方小说摘要后重新保存；保存前不会改动原文件。'; noteStatus.className = 'error'; }
  setBusy(false);
} catch { el('#load-status').textContent = '资料读取失败，请检查本机服务后刷新。'; el('#load-status').className = 'error'; }
