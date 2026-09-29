import './style.css';
import '../lab.css';
import { FLOWS, costOf, type Flow, type FlowResponse, type FlowResult, type SavedNote } from './contract.ts';
import type { Source, TEACHING_NOTE } from './materials.ts';

document.querySelector('#app')!.innerHTML = `
  <header><a href="/">请求观察室</a><span class="eyebrow">材料选择实验</span><h1>材料与记忆</h1><p>比较全文、选读和摘要；再试着用任务便笺开启新会话。</p></header>
  <section class="run-panel"><div><p class="run-description" id="question"></p><p>10 份教学虚构资料 · 每次比较调用模型 5 次</p></div><button id="start" disabled>比较三条流程</button></section>
  <p id="status" role="status">正在载入资料……</p>
  <section id="comparison" hidden><h2>三条流程的实际结果</h2><p class="note">对照最后一次输入与完整流程用量；回答需自行核对。</p><div class="table-scroll"><table><thead><tr><th>流程</th><th>实际调用</th><th>最后回答输入</th><th>整链输入</th><th>整链输出</th><th>输入＋输出</th><th>实际回答</th></tr></thead><tbody id="results"></tbody></table></div></section>
  <details id="request-detail" hidden><summary id="request-title">查看完整请求记录</summary><div id="request-content" class="inspector-body"></div></details>
  <details class="guide"><summary>查看资料目录与原文</summary><div class="guide-body"><p class="note">qwen-flash · 非思考 · 温度 0。目录用于导航，完整条款在原文中；浏览资料不调用模型。</p><div id="catalog"></div></div></details>
  <details class="note-section"><summary>跨会话：保存并读回任务便笺</summary><div class="note-body"><p class="badge">人工教学记录 · 非模型生成</p>
    <p class="note">便笺来自先前任务状态，由我们核对后保存。新会话会带上便笺和它指向的原文，不带旧聊天；这部分不与上面三条流程作同等总成本比较。</p>
    <div id="teaching-note"></div><label class="confirm"><input id="confirm" type="checkbox">我已核对这份人工教学便笺中的条件、未决事项与来源。</label>
    <div class="note-actions"><button id="save" class="secondary" disabled>确认并保存到本机</button><button id="resume" disabled>用便笺开始新会话 · 1 次调用</button></div><p id="note-status" class="note" role="status">便笺状态读取中……</p><div id="note-results"></div>
  </div></details>
  <details id="source-view" hidden><summary id="source-title">来源原文</summary><div id="source-content" class="guide-body"></div></details>
  <div class="download-bar"><button id="download" class="secondary" disabled>下载本页所有真实请求</button><span class="note">刷新前下载请求记录；已保存的便笺保留在本机。</span></div>`;

const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const start = el<HTMLButtonElement>('#start'), save = el<HTMLButtonElement>('#save'), resume = el<HTMLButtonElement>('#resume');
const status = el('#status'), noteStatus = el('#note-status'), confirm = el<HTMLInputElement>('#confirm');
const runs: FlowResult[] = [];
let busy = false, saved: SavedNote | null = null;
let materials: { question: string; sources: Source[]; teachingNote: typeof TEACHING_NOTE };
const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? '未返回';
const n = (value: number | null) => value === null ? '未完整返回' : value.toLocaleString('zh-CN');
function p(text: string, className = '') { const item = document.createElement('p'); item.textContent = text; item.className = className; return item; }
function detail(title: string, value: string, open = false) {
  const box = document.createElement('details'); box.className = 'json'; box.open = open;
  const heading = document.createElement('summary'); heading.textContent = title;
  const pre = document.createElement('pre'); pre.textContent = value; box.append(heading, pre); return box;
}
function setBusy(value: boolean) {
  busy = value; start.disabled = value || !materials; save.disabled = value || !confirm.checked; resume.disabled = value || !saved;
}
function sourceButton(id: string, label = id) {
  const button = document.createElement('button'); button.className = 'source-link'; button.textContent = label;
  button.addEventListener('click', async () => {
    const view = el<HTMLDetailsElement>('#source-view'); view.hidden = false; view.open = true;
    el('#source-title').textContent = `来源 ${id}`; el('#source-content').replaceChildren(p('正在读取对应原文……'));
    try {
      const response = await fetch(`/api/memory/sources/${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('source-missing');
      const source: Source = await response.json();
      el('#source-title').textContent = `[${source.id}] ${source.title}`;
      el('#source-content').replaceChildren(p(`日期：${source.date} · ${source.topic}`, 'note'), p(source.text));
    } catch { el('#source-content').replaceChildren(p('未能找到或读取这个编号的原文，请核对引用。', 'error')); }
    view.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }); return button;
}
function citations(text: string) {
  const ids = [...new Set(text.match(/C\d{2}/g) ?? [])]; const box = document.createElement('div'); box.className = 'citations';
  if (ids.length) { box.append(p('回查提到的来源：', 'note')); ids.forEach((id) => box.append(sourceButton(id))); }
  return box;
}
function showRun(result: FlowResult) {
  const box = el<HTMLDetailsElement>('#request-detail'); box.hidden = false; box.open = true;
  el('#request-title').textContent = `${FLOWS[result.flow]} · ${new Date(result.startedAt).toLocaleTimeString('zh-CN')}`;
  const content = el('#request-content'); content.replaceChildren();
  if (result.error) content.append(p(result.error.message, 'error'));
  if (result.answer) content.append(detail('模型实际回答 · 未自动判定语义正确性', result.answer, true), citations(result.answer));
  if (result.selectedIds) { content.append(p(`实际选中编号：${result.selectedIds.join('、')}`, 'note')); result.selectedIds.forEach((id) => content.append(sourceButton(id))); }
  if (result.summary !== undefined) content.append(detail('模型实际生成的任务摘要', result.summary, true), citations(result.summary));
  if (result.note) content.append(detail('从本机读取的人工便笺', pretty(result.note)));
  const costs = costOf(result);
  content.append(p(`最后回答输入 ${n(costs.finalInput)} · 整链输入 ${n(costs.totalInput)} · 整链输出 ${n(costs.totalOutput)} · 输入＋输出 ${n(costs.total)} token`, 'note'));
  result.requests.forEach((request, index) => {
    content.append(p(`第 ${index + 1} 次调用：${request.step} · HTTP ${request.httpStatus ?? '未返回'} · finish_reason ${request.finishReason ?? '未返回'} · ${request.durationMs ?? '—'} ms`, 'meta'));
    content.append(detail('真正发送的完整请求体', pretty(JSON.parse(request.requestBody))));
    content.append(detail('实际返回的消息与用量', pretty({ model: request.responseModel, message: request.responseMessage, usage: request.usage })));
  });
  if (!result.requests.length) content.append(p('本流程未发起模型调用。', 'note'));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderResults() {
  const compare = runs.filter((run) => run.flow !== 'note'); el('#comparison').hidden = !compare.length;
  el('#results').replaceChildren(...compare.map((result) => {
    const cost = costOf(result); const row = document.createElement('tr');
    [FLOWS[result.flow], String(result.requests.length), n(cost.finalInput), n(cost.totalInput), n(cost.totalOutput), n(cost.total)].forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    const answer = document.createElement('td'); const button = document.createElement('button'); button.className = 'link-button'; button.textContent = result.error ? '未完成 · 查看记录' : '展开回答与证据'; button.addEventListener('click', () => showRun(result)); answer.append(button); row.append(answer); return row;
  }));
  el('#note-results').replaceChildren(...runs.filter((run) => run.flow === 'note').map((result) => {
    const block = document.createElement('div'); block.className = 'note-result';
    if (result.answer) block.append(p(result.answer, 'answer'), citations(result.answer));
    else block.append(p(result.error?.message ?? '本次没有完整回答。', 'error'));
    const cost = costOf(result); block.append(p(`本次新会话：输入 ${n(cost.totalInput)}、输出 ${n(cost.totalOutput)} token；未计入先前任务及人工核对成本。`, 'note'));
    const button = document.createElement('button'); button.className = 'link-button'; button.textContent = '查看新会话实际输入'; button.addEventListener('click', () => showRun(result)); block.append(button); return block;
  }));
  el<HTMLButtonElement>('#download').disabled = !runs.length;
}
async function requestFlow(flow: Flow): Promise<FlowResponse> {
  const response = await fetch('/api/memory/flow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ flow }) });
  const data: FlowResponse = await response.json();
  if (!data.result || !Array.isArray(data.result.requests)) throw new Error('invalid-response');
  runs.push(data.result); renderResults(); return data;
}
start.addEventListener('click', async () => {
  if (busy) return; setBusy(true); status.className = '';
  try {
    for (const [index, flow] of (['full', 'retrieve', 'summary'] as const).entries()) {
      status.textContent = `正在运行流程 ${index + 1}/3：${FLOWS[flow]}……`;
      const data = await requestFlow(flow);
      if (!data.ok) { status.textContent = `${FLOWS[flow]}未完成：${data.result.error?.message} 已停止后续流程，没有自动重试。`; status.className = 'error'; return; }
    }
    status.textContent = '三条流程已完成。请展开真实回答，核对批准、时间和清场条件。';
  } catch { status.textContent = '未收到本机服务的有效结果，已有记录保留；本次模型执行状态未知。'; status.className = 'error'; }
  finally { setBusy(false); start.textContent = '重新比较 · 再调用 5 次'; }
});
confirm.addEventListener('change', () => { save.disabled = busy || !confirm.checked; });
save.addEventListener('click', async () => {
  if (busy || !confirm.checked) return; setBusy(true);
  try {
    const response = await fetch('/api/memory/note', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    saved = data.saved; noteStatus.textContent = `人工便笺已写入本机文件，确认时间：${saved!.confirmedAt}。重新启动服务后仍可读取。`;
  } catch { noteStatus.textContent = '便笺保存失败，请检查本机服务。'; }
  finally { setBusy(false); }
});
resume.addEventListener('click', async () => {
  if (busy || !saved) return; setBusy(true); noteStatus.textContent = '正在以空白会话读取便笺和来源原文……';
  try {
    const data = await requestFlow('note'); noteStatus.textContent = data.ok ? '新会话已回答；输入没有携带旧聊天消息，也没有修改模型权重。' : `新会话未完成：${data.result.error?.message}`;
  } catch { noteStatus.textContent = '未收到本机服务的有效结果，本次模型执行状态未知。'; }
  finally { setBusy(false); }
});
el('#download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([pretty({ question: materials.question, runs })], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = '材料选择与便笺-真实请求记录.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  const response = await fetch('/api/memory/materials'); if (!response.ok) throw new Error('materials-missing'); materials = await response.json();
  el('#question').textContent = materials.question;
  el('#catalog').replaceChildren(...materials.sources.map((source) => { const line = document.createElement('div'); line.className = 'catalog-line'; line.append(sourceButton(source.id, `[${source.id}] ${source.title}`), p(`${source.date} · ${source.topic} · ${source.snippet}`, 'note')); return line; }));
  const note = materials.teachingNote; const box = el('#teaching-note'); box.append(p(`目标：${note.goal}`));
  const groups = document.createElement('div'); groups.className = 'note-columns';
  for (const [title, items] of [['已确认的事实与条件', note.confirmed], ['仍待确认', note.pending]] as const) {
    const column = document.createElement('div'); const heading = document.createElement('h3'); heading.textContent = title; column.append(heading);
    items.forEach((item) => { const line = document.createElement('div'); line.className = 'note-fact'; line.append(p(item.text)); item.source_ids.forEach((id) => line.append(sourceButton(id))); column.append(line); }); groups.append(column);
  }
  box.append(groups, p(`下一步：${note.next_steps.join(' ')}`));
  box.append(p(`来源日期：${note.sources.map((source) => `${source.id} ${source.date}`).join('；')}`, 'note'));
  status.textContent = '';
  const noteResponse = await fetch('/api/memory/note'); const data = await noteResponse.json();
  if (noteResponse.ok) { saved = data.saved; noteStatus.textContent = saved ? `已从本机文件读取人工便笺，确认时间：${saved.confirmedAt}。` : '尚未保存便笺。请先打开来源核对，再勾选并保存。'; }
  else noteStatus.textContent = '本地便笺无法读取；可核对后重新保存。';
  setBusy(false);
} catch { status.textContent = '资料读取失败，请确认本机服务后刷新。'; status.className = 'error'; }
