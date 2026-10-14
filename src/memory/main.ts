import './style.css';
import '../lab.css';
import { FLOWS, costOf, type Flow, type FlowResponse, type FlowResult, type SavedNote } from './contract.ts';
import type { Source, TEACHING_NOTE } from './materials.ts';

document.querySelector('#app')!.innerHTML = `
  <header><h1>读取、压缩与记忆</h1><p>《凡人修仙传》原文30条。查一个细节，比较全文、选读和现场压缩。</p></header>
  <p id="load-status" role="status"></p>
  <div class="experiment-tabs" role="tablist" aria-label="实验内容">
    <button id="compare-tab" role="tab" aria-controls="compare-panel" aria-selected="true">读取与压缩</button>
    <button id="memory-tab" role="tab" aria-controls="memory-panel" aria-selected="false" tabindex="-1">保存与读回</button>
  </div>
  <section id="compare-panel" role="tabpanel" aria-labelledby="compare-tab">
    <div id="question" class="question"></div>
    <div id="catalog" class="materials"></div>
    <button id="start" disabled>比较三种读法</button><button id="classroom" class="secondary">查看课堂实录</button>
    <p class="note">全文和选读直接查细节；压缩先做300字阅读回顾，再问同一问题。检查摘要保留了什么。</p>
    <p id="status" role="status"></p>
    <div id="results" class="comparison-results"></div>
    <div id="compare-inspector" class="run-inspector"></div>
  </section>
  <section id="memory-panel" role="tabpanel" aria-labelledby="memory-tab" hidden>
    <p>核对下方人工整理的教学摘要，保存后在新请求中读回。</p>
    <p id="teaching-note" class="saved-note"></p>
    <div id="save-step"><button id="save" disabled>保存这条摘要</button></div>
    <div id="resume-step" hidden><button id="resume" disabled>读回摘要，再问一次</button></div>
    <p id="note-status" role="status"></p><div id="note-results"></div>
    <div id="note-inspector" class="run-inspector"></div>
  </section>
  <footer class="download-bar"><button id="download" class="secondary" disabled>下载运行记录</button></footer>`;

const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const start = el<HTMLButtonElement>('#start'), save = el<HTMLButtonElement>('#save'), resume = el<HTMLButtonElement>('#resume');
const status = el('#status'), noteStatus = el('#note-status');
const runs: FlowResult[] = [];
let busy = true, saved: SavedNote | null = null;
let materials: { question: string; sources: Source[]; teachingNote: typeof TEACHING_NOTE; originalExcerpt: string };
const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? '未返回';
function p(text: string, className = '') { const item = document.createElement('p'); item.textContent = text; item.className = className; return item; }
function heading(text: string, level: 'h3' | 'h4' = 'h3') { const item = document.createElement(level); item.textContent = text; return item; }
function disclosure(title: string) {
  const box = document.createElement('details');
  const label = document.createElement('summary'); label.textContent = title; box.append(label); return box;
}
function textDetail(title: string, value: string) {
  const box = disclosure(title), body = document.createElement('div'); body.className = 'inspection-content';
  const pre = document.createElement('pre'); pre.textContent = value; body.append(pre); box.append(body); return box;
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
  busy = value; start.disabled = value || !materials; save.disabled = value || !materials; resume.disabled = value || !saved;
}
function showSavedState() {
  el('#save-step').hidden = !!saved; el('#resume-step').hidden = !saved;
}
function requestInputs(result: FlowResult) {
  const box = disclosure(`${FLOWS[result.flow]} · 实际输入`); box.className = 'request-inputs';
  const body = document.createElement('div'); body.className = 'inspection-content';
  // 直接读取已发送的消息，不用回答或页面摘要重建输入。
  result.requests.forEach((request, index) => {
    const messages = JSON.parse(request.requestBody).messages;
    body.append(heading(`第 ${index + 1} 步：${request.step}`, 'h4'));
    for (const message of messages) {
      const label = message.role === 'system' ? '要求' : '资料';
      if (message.content.length > 1200) {
        // 大段原文按需展开，保存完整消息，不在显示时另作摘要。
        const detail = textDetail(`${label} · 完整输入 ${message.content.length} 字符`, message.content);
        body.append(detail);
      } else body.append(p(`${label}\n${message.content}`, 'input-message'));
    }
  });
  box.append(body);
  return box;
}
function renderResult(result: FlowResult) {
  const block = document.createElement('article'); block.className = 'flow-result';
  const main = document.createElement('div'); main.className = 'result-main';
  main.append(heading(result.flow === 'note' ? '读回后的回答' : FLOWS[result.flow]));
  const input = result.flow === 'full' ? `直接读入 ${materials.sources.length} 份原文`
    : result.flow === 'retrieve' ? `先选 ${result.selectedIds?.join('、') ?? '尚未选出资料'}，再读原文`
    : result.flow === 'summary' ? '30条原文 → 300字阅读摘要 → 新请求问细节' : '使用核对原文后保存的摘要';
  main.append(p(input, 'input-path'));
  if (result.summary !== undefined) {
    const originalLength = materials.sources.reduce((sum, source) => sum + source.text.length, 0);
    main.append(p(`原文正文 ${originalLength} 字符 → 摘要 ${result.summary.length} 字符`, 'input-path'));

  }
  if (result.answer) main.append(p(result.answer, 'answer'));
  if (result.summary !== undefined) main.append(textDetail('本次完整摘要', result.summary));
  if (result.error) main.append(p(result.error.message, 'error'));
  else if (!result.answer) main.append(p('没有取得完整回答。', 'error'));
  const actions = document.createElement('div'); actions.className = 'result-actions';
  for (const [label, input] of [['查看实际输入', true], ['用量与记录', false]] as const) {
    const button = document.createElement('button'); button.textContent = label;
    button.addEventListener('click', () => {
      // 详情独立占满宽度，结果列只保留简短回答。
      const area = el(result.flow === 'note' ? '#note-inspector' : '#compare-inspector');
      const detail = input ? requestInputs(result) : textDetail(`${FLOWS[result.flow]} · 用量与记录`, pretty({ 用量: costOf(result), 请求: result.requests }));
      detail.open = true; area.replaceChildren(detail);
    });
    actions.append(button);
  }
  block.append(main, actions);
  return block;
}
async function requestFlow(flow: Flow): Promise<FlowResponse> {
  const response = await fetch('/api/memory/flow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow }) });
  const data: FlowResponse = await response.json();
  if (!data.result || !Array.isArray(data.result.requests)) throw new Error('invalid-response');
  runs.push(data.result);
  // 各组返回后立即显示，保留已有结果。
  const result = renderResult(data.result);
  if (flow === 'note') el('#note-results').replaceChildren(result);
  else el('#results').append(result);
  el<HTMLButtonElement>('#download').disabled = false;
  return data;
}
start.addEventListener('click', async () => {
  if (busy) return; setBusy(true); status.className = ''; el('#results').replaceChildren(); el('#compare-inspector').replaceChildren();
  try {
    for (const [index, flow] of (['full', 'retrieve', 'summary'] as const).entries()) {
      status.textContent = `正在比较 ${index + 1}/3：${FLOWS[flow]}……`;
      const data = await requestFlow(flow);
      if (!data.ok) { status.textContent = '比较已停止。请查看下方错误，已有结果已保留。'; status.className = 'error'; return; }
    }
    status.textContent = '比较完成。核对实际摘要和各组输入，再判断回答是否有依据。';
  } catch { status.textContent = '未收到有效结果，执行状态未知。' + (runs.length ? '已有请求记录可下载。' : ''); status.className = 'error'; }
  finally { setBusy(false); start.textContent = '重新比较'; }
});
el('#classroom').addEventListener('click', async () => {
  if (busy || !materials) return;
  try {
    const response = await fetch('/records/凡人修仙传-memory.json');
    if (!response.ok) throw new Error();
    const record = await response.json() as { recordedAt: string; results: FlowResult[] };
    runs.splice(0, runs.length, ...record.results);
    el('#results').replaceChildren(...record.results.map(renderResult));
    el('#compare-inspector').replaceChildren();
    status.textContent = `课堂实录 · ${new Date(record.recordedAt).toLocaleString('zh-CN')} · 未新增请求。压缩和后续回答来自实录中的连续两次请求。`;
    el<HTMLButtonElement>('#download').disabled = false;
  } catch { status.textContent = '课堂实录读取失败，请检查仓库文件。'; }
});
save.addEventListener('click', async () => {
  if (busy) return; setBusy(true); noteStatus.className = 'note';
  try {
    const response = await fetch('/api/memory/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    saved = data.saved; showSavedState(); noteStatus.textContent = '已保存到本机。刷新页面后再读回，观察信息是否还在。';
  } catch { noteStatus.textContent = '摘要保存失败，请检查本机服务后重试。'; noteStatus.className = 'error'; }
  finally { setBusy(false); }
});
resume.addEventListener('click', async () => {
  if (busy || !saved) return; setBusy(true); noteStatus.className = 'note'; noteStatus.textContent = '正在从本机读回摘要……';
  el('#note-results').replaceChildren(); el('#note-inspector').replaceChildren();
  try {
    const data = await requestFlow('note'); noteStatus.textContent = data.ok ? '已用读回的摘要发出新请求。展开实际输入核对。' : '新会话未完成，请查看下方错误。';
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
  const originals = disclosure(`查看 ${materials.sources.length} 条资料目录与原文`);
  const body = document.createElement('div'); body.className = 'inspection-content';
  body.append(...materials.sources.map((source) => textDetail(`[${source.id}] ${source.title}`, source.text)));
  originals.append(body);
  el('#catalog').replaceChildren(p(`[C01] 原文节选：${materials.originalExcerpt}`), originals);
  el('#teaching-note').textContent = `${materials.teachingNote.text} [${materials.teachingNote.source_ids.join('、')}]`;
  el('#load-status').textContent = '';
  try {
    const noteResponse = await fetch('/api/memory/note'); const data = await noteResponse.json();
    if (!noteResponse.ok) throw new Error('note-unavailable');
    saved = data.saved; showSavedState(); noteStatus.textContent = saved ? '已从本机读回摘要。' : '';
  } catch { noteStatus.textContent = '本机摘要无法读取，请重新保存当前这条摘要。'; noteStatus.className = 'error'; }
  setBusy(false);
} catch { el('#load-status').textContent = '资料读取失败，请检查本机服务后刷新。'; el('#load-status').className = 'error'; }
