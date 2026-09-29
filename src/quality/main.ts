import './style.css';
import '../lab.css';
import { QUALITY_CONDITIONS, type Batch, type CaseResult, type QualityCase, type QualityCondition, type QualityResponse } from './contract.ts';

document.querySelector('#app')!.innerHTML = `
  <header><a href="/">请求观察室</a><a href="/context.html">上下文保留实验</a><span class="eyebrow">材料对照实验</span>
    <h1>材料对照</h1><p>改变材料长度、位置和干扰，比较提取结果与引用。</p></header>
  <section class="run-panel"><div><p class="run-description">6 种材料条件，每种比较样例 A / B</p><p>教学虚构资料 · 本次调用模型 12 次，按次计费</p></div><button id="run" disabled>运行 12 个样例</button></section>
  <p id="status" role="status">正在读取合成材料……</p><progress id="progress" max="12" value="0" hidden></progress>
  <section id="observations" hidden><div class="result-toolbar"><label for="batch">查看运行记录</label><select id="batch"></select><button id="download" class="secondary">下载这次运行</button></div>
    <p class="note">每种条件最多 2 例，不代表整体准确率。</p>
    <div class="table-scroll"><table><thead><tr><th>条件</th><th>实际输入 token</th><th>事实完整</th><th>引用正确</th><th>全部通过</th><th>逐例查看</th></tr></thead><tbody id="results"></tbody></table></div>
  </section>
  <details id="case-detail" hidden><summary id="case-title">查看一个样例</summary><div id="case-content" class="inspector-body"></div></details>
  <details class="guide"><summary>预览合成材料（不调用模型）</summary><div class="guide-body"><label for="preview">选择材料</label><select id="preview"></select><div id="preview-content"></div></div></details>
  <details class="guide"><summary>实验设置与判定口径</summary><div class="guide-body"><p>qwen-flash · 非思考 · 温度 0 · 输出上限 512 token · 禁用工具。串行执行，不自动重试。分母只计已返回文本的请求；失败单列，格式异常或截断不算通过。</p><dl>
    <dt>事实完整</dt><dd>状态、负责人和冻结日期三项都符合资料。冲突条件要求 conflict、负责人为 null、保留一致的冻结日期。</dd>
    <dt>引用正确</dt><dd>记录编号必须完整、准确且没有多余或重复项。冲突条件需要同时引用两条互相矛盾的记录。</dd>
    <dt>全部通过</dt><dd>输出结构完整，事实与引用同时正确。原始回答和期望值都可以展开核对。</dd>
    <dt>实际输入 token</dt><dd>取自各次 API 返回的 usage.prompt_tokens；条数不是 token 阈值，也没有使用其他模型的分词器估算。</dd>
    </dl><p>两份样例不足以代表某个模型的整体能力。全部通过也是有效观察；一次差异不能单独证明其原因。运行记录暂存在本页，刷新前请下载。</p></div></details>`;

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
function name(item: QualityCase) { return `${QUALITY_CONDITIONS[item.condition]} · 样例 ${item.sample}`; }
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
    const tokens = results.flatMap((result) => tokenCount(result) === undefined ? [] : [tokenCount(result)!]);
    const range = tokens.length ? (Math.min(...tokens) === Math.max(...tokens) ? String(tokens[0]) : `${Math.min(...tokens)}–${Math.max(...tokens)}`) : '—';
    const ratio = (predicate: (result: CaseResult) => boolean) => judged.length ? `${judged.filter(predicate).length} / ${judged.length}` : '—';
    const values = [QUALITY_CONDITIONS[condition], range, ratio((result) => result.assessment!.factsComplete), ratio((result) => result.assessment!.sourcesCorrect), ratio((result) => result.assessment!.allCorrect)];
    values.forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    const links = document.createElement('td'); links.className = 'sample-links';
    cases.filter((item) => item.condition === condition).forEach((item) => {
      const result = results.find((entry) => entry.caseId === item.id);
      const link = document.createElement('button'); link.className = 'link-button';
      link.textContent = `${item.sample} · ${!result ? '未运行' : result.error ? '请求失败' : !result.assessment?.valid ? '输出异常' : result.assessment.allCorrect ? '通过' : '有差异'}`;
      link.addEventListener('click', () => showCase(item, result)); links.append(link);
    });
    row.append(links); return row;
  }));
}

function showCase(item: QualityCase, result?: CaseResult) {
  const box = el<HTMLDetailsElement>('#case-detail'); box.hidden = false; box.open = true;
  el('#case-title').textContent = name(item);
  const content = el('#case-content'); content.replaceChildren(p(item.question));
  if (!result) content.append(p('这个样例尚未运行；下面只有合成材料和期望值。', 'note'));
  if (result?.error) content.append(p(`请求失败：${result.error.message}。不计入效果判定。`, 'error'));
  if (result?.answer !== null && result?.answer !== undefined) content.append(detail('模型返回原文', result.answer, true));
  const assessment = result?.assessment;
  if (assessment) {
    const judgment = assessment.valid
      ? `状态：${assessment.statusCorrect ? '正确' : '有差异'}；负责人：${assessment.ownerCorrect ? '正确' : '有差异'}；冻结日期：${assessment.dateCorrect ? '正确' : '有差异'}；引用：${assessment.sourcesCorrect ? '正确' : '有差异'}`
      : `输出异常：${assessment.issue}`;
    content.append(p(judgment, assessment.allCorrect ? 'passed' : 'error'));
  }
  content.append(detail('期望结果 · 本地评分依据，不发给模型', pretty(item.expected), true));
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
  el('#preview-content').replaceChildren(p(`${item.question} 共 ${item.documents.length} 条合成资料。`, 'note'), detail('预览资料全文', item.documents.map((document) => `[${document.id}] ${document.text}`).join('\n\n'), true));
}

button.addEventListener('click', async () => {
  if (busy || !cases.length) return;
  const batch: Batch = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), state: 'running', results: [] };
  batches.push(batch); busy = true; button.disabled = true; batchSelect.disabled = true;
  updateBatches(batch.id); renderTable(); el('#case-detail').hidden = true;
  progress.hidden = false; progress.value = 0; status.className = '';
  for (const [index, item] of cases.entries()) {
    status.textContent = `正在请求 ${index + 1} / 12：${name(item)}……`;
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
  if (batch.state === 'running') { batch.state = 'complete'; status.textContent = '12 个样例已完成。按条件比较结果，再展开具体样例核对证据。'; }
  busy = false; button.disabled = false; batchSelect.disabled = false; button.textContent = '新开始一次 · 12 个样例'; updateBatches(batch.id);
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
} catch { status.textContent = '合成材料读取失败，请确认本机服务已启动并刷新页面。'; status.className = 'error'; }
