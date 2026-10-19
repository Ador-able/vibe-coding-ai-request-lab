import './style.css';
import '../lab.css';
import { QUALITY_CONDITIONS, type Batch, type CaseResult, type QualityCase, type QualityCondition, type QualityResponse } from './contract.ts';

document.querySelector('#app')!.innerHTML = `
  <header>
    <h1>材料对照</h1><p>查韩立的实际修为和墨大夫误认的药名，比较原文长短和位置。</p></header>
  <section class="run-panel"><div><p class="run-description">《凡人修仙传》· 豪气生事实核对</p><p>4 种条件 · 每种调用模型 1 次</p></div><button id="run" disabled>运行 4 个样例</button><button id="classroom" class="secondary">查看课堂实录</button></section>
  <p id="status" role="status">正在读取小说原文……</p><progress id="progress" max="4" value="0" hidden></progress>
  <section id="observations" hidden><div class="result-toolbar"><label for="batch">查看运行记录</label><select id="batch"></select><button id="download" class="secondary">下载这次运行</button></div>
    <p class="note">各条件使用同一份原文，仅改变长度或位置；输出未完成时不评价事实与引用。</p>
    <div class="table-scroll"><table><thead><tr><th>条件</th><th>实际输入 token</th><th>事实完整</th><th>引用正确</th><th>全部通过</th><th>逐例查看</th></tr></thead><tbody id="results"></tbody></table></div>
  </section>
  <details id="case-detail" hidden><summary id="case-title">查看一个样例</summary><div id="case-content" class="inspector-body"></div></details>
  <details class="guide"><summary>预览小说原文（不调用模型）</summary><div class="guide-body"><label for="preview">选择材料</label><select id="preview"></select><div id="preview-content"></div></div></details>
  <details class="guide"><summary>实验设置与判定口径</summary><div class="guide-body"><p>温度 0 · 输出上限 8192 token（含推理与正文） · 禁用工具。串行执行，不自动重试。事实和引用只核对完整的结构化回答；请求失败、输出截断和格式异常单独标明，不算通过。</p><dl>
    <dt>事实完整</dt><dd>状态、当时的实际修为和墨大夫误认的药名都符合资料。</dd>
    <dt>引用正确</dt><dd>记录编号必须完整、准确且没有多余或重复项。</dd>
    <dt>全部通过</dt><dd>输出结构完整，事实与引用同时正确。原始回答和期望值都可以展开核对。</dd>
    <dt>实际输入 token</dt><dd>取自各次 API 返回的 usage.prompt_tokens；条数不是 token 阈值，也没有使用其他模型的分词器估算。</dd>
    </dl><p>单次对照不足以代表某个模型的整体能力。全部通过也是有效观察；一次差异不能单独证明其原因。运行记录暂存在本页，刷新前请下载。</p></div></details>`;

const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const button = el<HTMLButtonElement>('#run');
const status = el<HTMLParagraphElement>('#status');
const batchSelect = el<HTMLSelectElement>('#batch');
const previewSelect = el<HTMLSelectElement>('#preview');
const progress = el<HTMLProgressElement>('#progress');
let cases: QualityCase[] = [];
const batches: Batch[] = [];
let busy = false;

const pretty = (value: unknown) => JSON.stringify(value, null, 2) ?? '未返回';
function p(text: string, className = '') { const node = document.createElement('p'); node.textContent = text; node.className = className; return node; }
function detail(title: string, value: string, open = false) {
  const node = document.createElement('details'); node.className = 'json'; node.open = open;
  const label = document.createElement('summary'); label.textContent = title;
  const pre = document.createElement('pre'); pre.textContent = value; node.append(label, pre); return node;
}
function selectedBatch() { return batches.find((batch) => batch.id === batchSelect.value); }
function name(item: QualityCase) { return `${QUALITY_CONDITIONS[item.condition]} · ${item.id}`; }
function tokenCount(result: CaseResult): number | undefined {
  const usage = result.request?.usage;
  return usage && typeof usage === 'object' && 'prompt_tokens' in usage && typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
}
function updateBatches(selectedId: string) {
  batchSelect.replaceChildren(...batches.map((batch, index) => {
    const option = document.createElement('option'); option.value = batch.id;
    option.textContent = `运行 ${index + 1} · ${batch.state === 'complete' ? '已完成' : batch.state === 'failed' ? '遇到请求失败' : '进行中'} · ${new Date(batch.startedAt).toLocaleTimeString('zh-CN')}`;
    return option;
  }));
  batchSelect.value = selectedId;
}

function renderTable() {
  const batch = selectedBatch(); if (!batch) return;
  el('#observations').hidden = false;
  el('#results').replaceChildren(...(Object.keys(QUALITY_CONDITIONS) as QualityCondition[]).map((condition) => {
    const row = document.createElement('tr');
    const results = batch.results.filter((result) => cases.find((item) => item.id === result.caseId)?.condition === condition);
    const judged = results.filter((result) => result.assessment && !result.error);
    const complete = judged.filter((result) => result.assessment!.valid);
    const tokens = results.flatMap((result) => tokenCount(result) === undefined ? [] : [tokenCount(result)!]);
    const range = tokens.length ? (Math.min(...tokens) === Math.max(...tokens) ? String(tokens[0]) : `${Math.min(...tokens)}–${Math.max(...tokens)}`) : '—';
    const ratio = (entries: CaseResult[], predicate: (result: CaseResult) => boolean) => entries.length ? `${entries.filter(predicate).length} / ${entries.length}` : '—';
    const values = [QUALITY_CONDITIONS[condition], range, ratio(complete, (result) => result.assessment!.factsComplete), ratio(complete, (result) => result.assessment!.sourcesCorrect), ratio(judged, (result) => result.assessment!.allCorrect)];
    values.forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    const links = document.createElement('td'); links.className = 'sample-links';
    cases.filter((item) => item.condition === condition).forEach((item) => {
      const result = results.find((entry) => entry.caseId === item.id);
      const link = document.createElement('button'); link.className = 'link-button';
      link.textContent = `${item.id} · ${!result ? '未运行' : result.error ? '请求失败' : result.request?.finishReason === 'length' ? '输出截断' : !result.assessment?.valid ? '输出异常' : result.assessment.allCorrect ? '通过' : '有差异'}`;
      link.addEventListener('click', () => showCase(item, result)); links.append(link);
    });
    row.append(links); return row;
  }));
}

function showCase(item: QualityCase, result?: CaseResult) {
  const box = el<HTMLDetailsElement>('#case-detail'); box.hidden = false; box.open = true;
  el('#case-title').textContent = name(item);
  const content = el('#case-content'); content.replaceChildren(p(item.question));
  if (!result) content.append(p('这个样例尚未运行；下面只有小说原文和期望值。', 'note'));
  if (result?.error) content.append(p(`请求失败：${result.error.message}。不计入效果判定。`, 'error'));
  if (result?.answer !== null && result?.answer !== undefined) content.append(detail('模型返回原文', result.answer));
  const assessment = result?.assessment;
  if (assessment) {
    const judgment = assessment.valid
      ? `状态：${assessment.statusCorrect ? '正确' : '有差异'}；实际修为：${assessment.levelCorrect ? '正确' : '有差异'}；误认药名：${assessment.drugCorrect ? '正确' : '有差异'}；引用：${assessment.sourcesCorrect ? '正确' : '有差异'}`
      : `输出异常：${assessment.issue}`;
    content.append(p(judgment, assessment.allCorrect ? 'passed' : 'error'));
  }
  if (assessment?.parsed) {
    const answer = assessment.parsed;
    content.prepend(p(`实际结果：长春功第${answer.actual_level ?? '未知'}层，误认药名为${answer.mistaken_drug ?? '未知'}；依据 ${answer.source_ids.join('、') || '未提供'}。`));
  }
  content.append(p(`原文核对：长春功第${item.expected.actual_level}层，误认药名为${item.expected.mistaken_drug}。`, 'note'));
  content.append(detail('完整评分依据 · 不发给模型', pretty(item.expected)));
  if (result?.request) {
    const request = result.request;
    content.append(p(`HTTP ${request.httpStatus ?? '未返回'} · finish_reason: ${request.finishReason ?? '未返回'} · ${request.durationMs ?? '—'} ms`, 'meta'));
    content.append(detail('真正发送的请求体', pretty(JSON.parse(request.requestBody))));
    content.append(detail('API 返回的消息与用量', pretty({ message: request.responseMessage, usage: request.usage, responseModel: request.responseModel })));
  }
  content.append(detail(`全部资料 · ${item.documents.length} 条`, item.documents.map((document) => `[${document.id}] ${document.text}`).join('\n\n')));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function preview() {
  const item = cases.find((entry) => entry.id === previewSelect.value); if (!item) return;
  el('#preview-content').replaceChildren(p(`${item.question} 共 ${item.documents.length} 条原文片段。`, 'note'), detail('预览资料全文', item.documents.map((document) => `[${document.id}] ${document.text}`).join('\n\n'), true));
}

button.addEventListener('click', async () => {
  if (busy || !cases.length) return;
  const batch: Batch = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), state: 'running', results: [] };
  batches.push(batch); busy = true; button.disabled = true; batchSelect.disabled = true;
  updateBatches(batch.id); renderTable(); el('#case-detail').hidden = true;
  progress.hidden = false; progress.value = 0; status.className = '';
  for (const [index, item] of cases.entries()) {
    status.textContent = `正在请求 ${index + 1} / ${cases.length}：${name(item)}……`;
    try {
      const response = await fetch('/api/quality/case', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caseId: item.id }) });
      const data: QualityResponse = await response.json();
      if (!data.result || data.result.caseId !== item.id) throw new Error('invalid-response');
      batch.results.push(data.result); progress.value = index + 1; renderTable();
      if (!data.ok || data.result.error) {
        batch.state = 'failed'; status.textContent = `已停止在 ${name(item)}：${data.result.error?.message ?? '请求失败'}。已有结果保留，没有自动重试。`; status.className = 'error'; break;
      }
    } catch {
      batch.results.push({ caseId: item.id, startedAt: new Date().toISOString(), answer: null, expected: item.expected, error: { code: 'LOCAL_REQUEST_FAILED', message: '没有收到本机服务的有效回复；模型是否完成本次请求未知。' } });
      batch.state = 'failed'; status.textContent = `已停止在 ${name(item)}：本机回复无效，已有结果保留。`; status.className = 'error'; renderTable(); break;
    }
  }
  if (batch.state === 'running') { batch.state = 'complete'; status.textContent = '4 个请求已结束。先查看输出是否完整，再比较事实与引用。'; }
  busy = false; button.disabled = false; batchSelect.disabled = false; button.textContent = '新开始一次 · 4 个样例'; updateBatches(batch.id);
});
el('#classroom').addEventListener('click', async () => {
  if (busy || !cases.length) return;
  try {
    const response = await fetch('/records/凡人修仙传-quality.json');
    if (!response.ok) throw new Error();
    const batch = await response.json() as Batch;
    batches.push(batch); updateBatches(batch.id); renderTable();
    status.textContent = '历史运行实录 · 查看记录不会调用模型。';
  } catch { status.textContent = '课堂实录读取失败，请检查仓库文件。'; }
});
batchSelect.addEventListener('change', () => { renderTable(); el('#case-detail').hidden = true; });
previewSelect.addEventListener('change', preview);
el('#download').addEventListener('click', () => {
  const batch = selectedBatch(); if (!batch) return;
  const url = URL.createObjectURL(new Blob([pretty(batch)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `材料对照实验-${batch.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

try {
  const response = await fetch('/api/quality/cases'); if (!response.ok) throw new Error('load-failed');
  cases = await response.json();
  previewSelect.replaceChildren(...cases.map((item) => { const option = document.createElement('option'); option.value = item.id; option.textContent = name(item); return option; }));
  preview(); button.disabled = false; status.textContent = '';
} catch { status.textContent = '小说原文读取失败，请确认本机服务已启动并刷新页面。'; status.className = 'error'; }
