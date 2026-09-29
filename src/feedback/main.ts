import './style.css';
import '../lab.css';
import { CATALOG, ORDERS, SUGGESTED_RULE } from './scenario.ts';
import type { FeedbackResponse, FeedbackRun, RuleMode, RuleResponse, SavedRule } from './contract.ts';

document.querySelector<HTMLElement>('#app')!.innerHTML = `<header><a href="/">请求观察室</a><span class="eyebrow">人的反馈 · 订单简称</span>
  <h1>订单规则对照</h1><p>比较同一订单在不带规则与附带已确认规则时的回答。</p></header>
  <section class="reference"><div><h2>产品目录 · 教学虚构</h2><table><thead><tr><th>编号</th><th>名称</th></tr></thead><tbody id="catalog"></tbody></table></div>
    <div><h2>三个新订单</h2><table><thead><tr><th>订单</th><th>客户</th><th>原话</th></tr></thead><tbody id="orders"></tbody></table></div></section>
  <details id="rule-panel"><summary id="rule-summary">业务规则 · 正在读取</summary><div class="rule-body">
    <p class="note">客户简称只在约定范围内适用，不能推广到其他客户或明确的产品描述。</p><label for="rule-text">规则内容与适用范围</label><textarea id="rule-text" rows="3" maxlength="2000"></textarea>
    <label class="confirm"><input id="confirmed" type="checkbox" />我已核对规则内容及其客户、描述范围</label>
    <div class="rule-actions"><button id="save-rule" class="secondary" disabled>确认保存并启用</button><button id="disable-rule" class="secondary" disabled>停用已保存规则</button></div>
    <p id="rule-note" class="note"></p><p id="rule-status" class="note" role="status"></p>
  </div></details>
  <section class="run-controls"><label for="order">订单<select id="order"></select></label>
    <label for="mode">本次输入<select id="mode"><option value="none">不带规则</option><option value="saved">附带当前已保存规则</option></select></label>
    <button id="run">处理所选订单</button></section>
  <p id="run-hint" class="note"></p><p id="status" role="status" aria-live="polite"></p>
  <section id="results" hidden><div class="section-heading"><h2>订单处理结果</h2><button id="download" class="secondary">下载全部记录</button></div>
    <div class="table-scroll"><table class="results-table"><thead><tr><th>订单</th><th>规则</th><th>模型给出的sku</th><th>输入 / 输出 token</th><th>记录</th></tr></thead><tbody id="rows"></tbody></table></div>
    <section class="selected-result"><h3 id="result-title"></h3><p id="snapshot" class="snapshot"></p><p id="snapshot-time" class="meta"></p><h3>模型原始回答</h3><pre id="raw-answer"></pre>
      <p class="note">对照目录与规则核对判断；刷新前下载记录。</p>
      <details><summary>查看本次实际请求、响应与用量</summary><div id="inspector" class="inspector-body"></div></details>
    </section>
  </section>`;
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const cells = (texts: string[]) => { const row = document.createElement('tr'); for (const text of texts) { const cell = document.createElement('td'); cell.textContent = text; row.append(cell); } return row; };
for (const item of CATALOG) get('catalog').append(cells([item.sku, item.name]));
for (const order of ORDERS) { get('orders').append(cells([order.id, order.customer, order.text])); get<HTMLSelectElement>('order').add(new Option(`${order.id} · ${order.customer}`, order.id)); }
get<HTMLTextAreaElement>('rule-text').value = SUGGESTED_RULE;

type Work = { orderId: string; ruleMode: RuleMode; startedAt: string; run: FeedbackRun | null; transportError: string | null };
const works: Work[] = [];
const ruleEvents: { action: 'save' | 'disable'; at: string; rule: SavedRule | null }[] = [];
let savedRule: SavedRule | null = null;
let ruleLoaded = false;
let ruleBusy = true;
let runBusy = false;
let current = -1;
const mode = () => get<HTMLSelectElement>('mode').value as RuleMode;

function controls() {
  const busy = runBusy || ruleBusy;
  for (const id of ['order', 'mode', 'rule-text', 'confirmed']) get<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id).disabled = busy;
  get<HTMLButtonElement>('run').disabled = busy || mode() === 'saved' && (!ruleLoaded || !savedRule?.enabled);
  get<HTMLButtonElement>('save-rule').disabled = busy || !get<HTMLInputElement>('confirmed').checked || !get<HTMLTextAreaElement>('rule-text').value.trim();
  get<HTMLButtonElement>('disable-rule').disabled = busy || !savedRule?.enabled;
  get('rule-summary').textContent = ruleBusy ? '业务规则 · 正在处理' : !ruleLoaded ? '业务规则 · 尚未读取成功' : !savedRule ? '业务规则 · 尚未确认保存' : `业务规则 · ${savedRule.enabled ? '已启用' : '已停用'}`;
  const dirty = get<HTMLTextAreaElement>('rule-text').value.trim() !== savedRule?.text;
  get('rule-note').textContent = !savedRule ? '这是一条教学规则示例。勾选核对后保存，才会用于带规则的请求。'
    : `${savedRule.enabled ? '已确认的规则仅保存在本实验本机。' : '已停用，带规则的请求不会继续。'}${dirty ? '编辑尚未保存，本次仍以已保存内容为准。' : ''}`;
  get('run-hint').textContent = mode() === 'none' ? '本次不附加规则；每次都是新请求，不带前次对话。'
    : savedRule?.enabled ? '后台将读取当前已保存规则；本次使用的快照会随结果保留。' : '请先展开业务规则，核对后保存并启用。';
}

async function changeRule(action: 'save' | 'disable') {
  if (ruleBusy || runBusy) return;
  ruleBusy = true; controls(); get('rule-status').className = 'note'; get('rule-status').textContent = '正在保存…';
  try {
    const response = await fetch(action === 'save' ? '/api/feedback/rule' : '/api/feedback/rule/disable', {
      method: action === 'save' ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: action === 'save' ? JSON.stringify({ text: get<HTMLTextAreaElement>('rule-text').value, confirmed: get<HTMLInputElement>('confirmed').checked }) : '{}',
    });
    const data = await response.json() as RuleResponse;
    if (!response.ok || data.error) throw new Error(data.error || '规则操作未完成。');
    savedRule = data.rule; ruleLoaded = true;
    ruleEvents.push({ action, at: new Date().toISOString(), rule: savedRule });
    if (savedRule) get<HTMLTextAreaElement>('rule-text').value = savedRule.text;
    get<HTMLInputElement>('confirmed').checked = false;
    get('rule-status').textContent = action === 'save' ? '规则已确认保存并启用。' : '规则已停用，已有请求记录不变。';
  } catch (error) {
    get('rule-status').className = 'error'; get('rule-status').textContent = error instanceof Error ? error.message : '规则操作未完成。';
  } finally { ruleBusy = false; controls(); }
}

function usageText(run: FeedbackRun | null) {
  const usage = run?.request?.usage as { prompt_tokens?: unknown; completion_tokens?: unknown } | null;
  return `${typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : '未提供'} / ${typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : '未提供'}`;
}
function renderResults() {
  controls();
  const work = works[current];
  const error = work?.transportError || work?.run?.error?.message;
  get('status').textContent = runBusy ? '正在处理当前订单…' : error || (work?.run?.answer ? '已收到模型回答，请对照目录和规则范围检查。' : '');
  get('status').className = !runBusy && error ? 'error' : '';
  get('results').hidden = !works.length;
  get<HTMLButtonElement>('download').disabled = runBusy;
  const rows = get('rows'); rows.replaceChildren();
  works.forEach((item, index) => {
    const answer = item.run?.answer;
    const row = cells([item.orderId, item.ruleMode === 'none' ? '不带规则' : '已保存规则',
      answer ? answer.sku === null ? 'null · 待确认' : answer.sku : item.run?.error || item.transportError ? '未完成' : '等待中', usageText(item.run)]);
    row.className = index === current ? 'selected' : '';
    const cell = document.createElement('td'); const button = document.createElement('button'); button.className = 'link-button'; button.textContent = `查看第${index + 1}次`;
    button.disabled = runBusy; button.addEventListener('click', () => { current = index; renderResults(); }); cell.append(button); row.append(cell); rows.append(row);
  });
  if (!work) return;
  const run = work.run;
  get('result-title').textContent = `第${current + 1}次 · 订单${work.orderId} · ${work.ruleMode === 'none' ? '不带规则' : '按已保存规则'}`;
  get('snapshot').textContent = run?.ruleSnapshot ? `本次读取的规则：${run.ruleSnapshot.text}`
    : work.ruleMode === 'none' ? '本次没有附加业务规则。' : '尚无本次规则快照。';
  get('snapshot-time').textContent = run?.ruleSnapshot ? `人工确认：${new Date(run.ruleSnapshot.confirmedAt).toLocaleString()} · ${run.ruleSnapshot.enabled ? '启用' : '停用，未调用模型'}` : '';
  get('raw-answer').textContent = run?.rawAnswer ?? (runBusy ? '等待返回…' : '本次没有取得模型正文。');
  const inspector = get('inspector'); inspector.replaceChildren();
  if (run?.request) {
    for (const [label, text] of [['实际请求体', run.request.requestBody], ['原始响应', JSON.stringify(run.request.responseMessage ?? null, null, 2)], ['实际用量与状态', JSON.stringify({ usage: run.request.usage ?? null, httpStatus: run.request.httpStatus, finishReason: run.request.finishReason, durationMs: run.request.durationMs, error: run.error }, null, 2)]]) {
      const details = document.createElement('details'); details.className = 'json';
      const summary = document.createElement('summary'); summary.textContent = label;
      const pre = document.createElement('pre'); pre.textContent = text; details.append(summary, pre); inspector.append(details);
    }
  } else { const p = document.createElement('p'); p.textContent = error || '还没有取得实际请求记录。'; inspector.append(p); }
}

get('run').addEventListener('click', async () => {
  if (runBusy || ruleBusy) return;
  const work: Work = { orderId: get<HTMLSelectElement>('order').value, ruleMode: mode(), startedAt: new Date().toISOString(), run: null, transportError: null };
  works.push(work); current = works.length - 1; runBusy = true; renderResults();
  try {
    const response = await fetch('/api/feedback/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: work.orderId, ruleMode: work.ruleMode }) });
    const data = await response.json() as FeedbackResponse & { error?: string };
    if (!data.run) throw new Error(data.error || '没有收到实验记录。');
    work.run = data.run;
  } catch (error) { work.transportError = error instanceof Error ? error.message : '本机连接中断，没有自动重试。'; }
  finally { runBusy = false; renderResults(); }
});
get('save-rule').addEventListener('click', () => { void changeRule('save'); });
get('disable-rule').addEventListener('click', () => { void changeRule('disable'); });
get('mode').addEventListener('change', controls);
get('confirmed').addEventListener('change', controls);
get('rule-text').addEventListener('input', () => { get<HTMLInputElement>('confirmed').checked = false; controls(); });
get('download').addEventListener('click', () => {
  const payload = { catalog: CATALOG, orders: ORDERS, ruleAtExport: savedRule, ruleEvents, attempts: works };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = '订单规则-实际请求记录.json'; link.click(); URL.revokeObjectURL(url);
});
async function loadRule() {
  try {
    const response = await fetch('/api/feedback/rule'); const data = await response.json() as RuleResponse;
    if (!response.ok || data.error) throw new Error(data.error || '规则未能读取。');
    savedRule = data.rule; ruleLoaded = true;
    if (savedRule) get<HTMLTextAreaElement>('rule-text').value = savedRule.text;
  } catch (error) { get('rule-status').className = 'error'; get('rule-status').textContent = error instanceof Error ? error.message : '规则未能读取。'; }
  ruleBusy = false; controls();
}
controls(); void loadRule();
