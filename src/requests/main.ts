import { APICallError, DefaultChatTransport, readUIMessageStream } from 'ai';
import type { UIMessageChunk } from 'ai';
import { observed, terminal } from './contract.ts';
import type { Catalog, FixtureKey, Message, RequestRecord, Scenario, State, Timed } from './contract.ts';
import './style.css';

type ClientState = 'waiting' | 'streaming' | 'completed' | 'ended' | 'failed' | 'local-stopped';
type Attempt = {
  requestId: string; fixtureKey: FixtureKey; scenario: Scenario; input: string; instructions: string;
  beganAt: string; endedAt: string | null; clientState: ClientState; stopRequestedAt: string | null;
  controller: AbortController; startClock: number; message: Message | null;
  actions: Array<Timed<unknown>>; httpInput: unknown; httpResponse: unknown;
  frames: Array<Timed<UIMessageChunk>>; snapshots: Message[]; sdkErrors: unknown[]; transportError: unknown;
  cancelReceipt: unknown; readReceipts: unknown[]; serverRecord: RequestRecord | null;
  rejectedBeforeModel: boolean;
};
type CompletedView = { requestId: string; fixtureKey: FixtureKey; input: string; message: Message; endedAt: string | null };
type LiveCatalog = Catalog & { serviceId: string; sourceVersion: string };

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="page-heading"><div><p class="eyebrow">AI 请求观察 · 受控演练</p><h1>小说资料整理</h1>
    <p class="intro">《凡人修仙传》原文回显 · 受控演练 · 不调用云模型</p></div></header>
  <main>
    <div class="workspace">
      <section class="input-panel panel"><h2>准备这次工作</h2>
        <details class="material-panel"><summary>查看完整材料</summary><label for="material" class="sr-only">完整输入</label><textarea id="material" rows="8" spellcheck="false"></textarea></details>
        <details class="settings"><summary>选择下次演练</summary><div class="choices">
          <label>下次材料<select id="fixture"><option value="A">A · 第一条原文</option><option value="B">B · 第二条原文</option></select></label>
          <label>下次条件<select id="scenario"></select></label>
        </div><p class="quiet">本页只使用两份固定全文。模拟文字不理解自行改动。</p></details>
        <div class="actions"><button id="run">开始演练</button><button id="stop" hidden>停止本次</button><button id="inspect" class="secondary" hidden>核查本次记录</button></div>
        <p id="status" role="status" aria-live="polite"></p>
      </section>
      <section class="current-panel panel"><p class="section-label">当前任务</p><h2 id="current-title">还没有提交</h2>
        <p id="current-context" class="quiet"></p><div id="answer" class="answer empty">收到的文字会在这里显示。</div><p id="current-boundary" class="boundary"></p></section>
      <details class="previous-panel panel" id="previous-panel" hidden><summary>上次完整结果</summary><h2 id="previous-title"></h2>
        <p id="previous-context" class="quiet"></p><div id="previous-answer" class="answer"></div><p class="boundary">内容仍需回原文核对。</p></details>
    </div>
    <section class="evidence-panel"><details id="evidence"><summary>查看完整输入、事件与两端记录</summary>
      <p class="quiet">原始客户端异常与模拟服务原因保留在记录中；没有自动再次提交。</p>
      <h3>页面收到的消息与动作</h3><pre id="client-record"></pre>
      <h3>人工核查的服务端对象</h3><pre id="server-record"></pre>
      <button id="download" class="secondary">下载本页完整记录</button>
    </details></section>
  </main>`;
const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
const textarea = get<HTMLTextAreaElement>('material');
const fixtureChoice = get<HTMLSelectElement>('fixture');
const scenarioChoice = get<HTMLSelectElement>('scenario');
let catalog: LiveCatalog | null = null, current: Attempt | null = null, previous: CompletedView | null = null;
let busy = false, reading = false, loading = true, loadError: unknown = null;
const attempts: Attempt[] = [];
const text = (message: Message | null) => message?.parts.filter(part => part.type === 'text').map(part => part.text).join('') ?? '';
const stamp = (attempt: Attempt, value: unknown): Timed<unknown> => ({ at: new Date().toISOString(), elapsedMs: Math.round((performance.now() - attempt.startClock) * 10) / 10, value });
const publicAttempt = (attempt: Attempt) => {
  const { controller, startClock: _clock, ...value } = attempt;
  return { ...value, localSignal: observed(controller.signal) };
};
const knownState = (attempt: Attempt): State | null => {
  const state = attempt.serverRecord?.state ?? attempt.message?.metadata?.state;
  return state && terminal(state) ? state : null;
};
const needsConfirmation = (attempt: Attempt) => !attempt.rejectedBeforeModel && attempt.clientState !== 'completed'
  && !['waiting', 'streaming'].includes(attempt.clientState) && knownState(attempt) === null;
const stateText = (attempt: Attempt) => {
  if (reading && current === attempt) return '正在核查原编号，已有输入和片段保留。';
  if (busy && current === attempt) return attempt.stopRequestedAt ? '已提出停止要求，正在等待本次结束反馈。' : '本次正在处理，完整输入保留。';
  const state = knownState(attempt);
  if (state === 'completed') return attempt.clientState === 'completed' ? '本次流已完整结束，内容仍需核对。'
    : '服务端记录显示已完成；页面收到的片段仍保留，请展开记录核对完整结果。';
  if (state === 'timed-out') return '等待预算耗尽，输入和收到的片段保留；没有自动再提交。';
  if (state === 'cancelled') return attempt.serverRecord?.cause === 'connection-closed' || attempt.message?.metadata?.cause === 'connection-closed'
    ? '记录确认连接提前关闭后停止；输入和片段保留。' : '记录确认本次已停止；输入和片段保留。';
  if (state === 'failed') return attempt.scenario === 'permission' && (attempt.serverRecord?.cause ?? attempt.message?.metadata?.cause) === 'provider-error' ? '模拟提供方拒绝处理；先检查授权条件，再决定下一步。'
    : '本次未完成，输入和片段保留；按原原因决定下一步。';
  if (attempt.rejectedBeforeModel) return '输入尚未进入模型演练，请保留草稿并载入固定全文。';
  return '本次完成情况尚未确认。先核查这个编号，保留输入和收到的片段。';
};

function render() {
  const pending = current !== null && needsConfirmation(current);
  get<HTMLButtonElement>('run').disabled = loading || busy;
  get('run').textContent = !catalog ? '重新读取材料' : pending ? '核查本次记录' : current ? '再次演练' : '开始演练';
  get('stop').hidden = !busy || reading;
  get<HTMLButtonElement>('stop').disabled = current?.stopRequestedAt !== null;
  get('inspect').hidden = !current || busy || pending;
  textarea.disabled = loading || busy; fixtureChoice.disabled = loading || busy; scenarioChoice.disabled = loading || busy;
  get('status').textContent = loading ? '正在读取两份完整材料。' : !catalog ? '材料未能载入，请检查本地服务后重新读取。'
    : current ? stateText(current) : '输入已准备，可开始本次演练。';
  get('status').className = current && (needsConfirmation(current) || ['failed', 'timed-out'].includes(knownState(current) ?? '')) ? 'error' : '';
  get('current-title').textContent = current && catalog ? `${current.fixtureKey} · ${catalog.fixtures[current.fixtureKey].title}` : '还没有提交';
  get('current-context').textContent = current && catalog ? catalog.scenarios.find(item => item.key === current!.scenario)!.label : '';
  const answer = text(current?.message ?? null);
  get('answer').textContent = answer || (current ? '本次还没有收到文字。' : '收到的文字会在这里显示。');
  get('answer').className = answer ? 'answer' : 'answer empty';
  get('current-boundary').textContent = current ? `编号 ${current.requestId.slice(0, 8)} · ${current.clientState === 'completed' ? '技术完整，未认证内容' : '只显示本次实际收到的文字'}` : '';
  const showPrevious = previous && previous.requestId !== current?.requestId;
  get('previous-panel').hidden = !showPrevious;
  if (previous && catalog) {
    get('previous-title').textContent = `${previous.fixtureKey} · ${catalog.fixtures[previous.fixtureKey].title}`;
    get('previous-context').textContent = `编号 ${previous.requestId.slice(0, 8)} · 完成于 ${previous.endedAt ?? '未知'}`;
    get('previous-answer').textContent = text(previous.message);
  }
  get('client-record').textContent = JSON.stringify(current ? publicAttempt(current) : { catalogLoaded: catalog !== null, loadError }, null, 2);
  get('server-record').textContent = current?.serverRecord ? JSON.stringify(current.serverRecord, null, 2) : '尚未人工读取本次服务端记录。';
}

async function load() {
  loading = true; render();
  try {
    const response = await fetch('/api/requests/catalog');
    if (!response.ok) throw new Error(`材料读取HTTP ${response.status}`);
    catalog = await response.json() as LiveCatalog;
    scenarioChoice.replaceChildren(...catalog.scenarios.map(item => { const option = document.createElement('option'); option.value = item.key; option.textContent = item.label; return option; }));
    textarea.value = catalog.fixtures[fixtureChoice.value as FixtureKey].input;
    loadError = null;
  } catch (error) { loadError = observed(error); }
  finally { loading = false; render(); }
}

async function run() {
  if (!catalog || busy || current && needsConfirmation(current)) return;
  const fixtureKey = fixtureChoice.value as FixtureKey;
  const attempt: Attempt = { requestId: crypto.randomUUID(), fixtureKey, scenario: scenarioChoice.value as Scenario,
    input: textarea.value, instructions: catalog.fixtures[fixtureKey].instructions,
    beganAt: new Date().toISOString(), endedAt: null, clientState: 'waiting', stopRequestedAt: null,
    controller: new AbortController(), startClock: performance.now(), message: null,
    actions: [], httpInput: null, httpResponse: null, frames: [], snapshots: [], sdkErrors: [], transportError: null,
    cancelReceipt: null, readReceipts: [], serverRecord: null, rejectedBeforeModel: false };
  current = attempt; attempts.push(attempt); busy = true;
  attempt.actions.push(stamp(attempt, { kind: 'user-submit' })); render();
  const transport = new DefaultChatTransport<Message>({ api: '/api/requests',
    fetch: async (url, init) => {
      attempt.httpInput = { url: String(url), method: init?.method, headers: Object.fromEntries(new Headers(init?.headers)), body: observed(init?.body) };
      const response = await fetch(url, init);
      attempt.httpResponse = { status: response.status, headers: Object.fromEntries(response.headers) };
      return response;
    },
  });
  try {
    const stream = await transport.sendMessages({ trigger: 'submit-message', chatId: attempt.requestId, messageId: undefined,
      messages: [{ id: `${attempt.requestId}:user`, role: 'user', parts: [{ type: 'text', text: attempt.input }] }],
      abortSignal: attempt.controller.signal, body: { fixtureKey, scenario: attempt.scenario } });
    attempt.clientState = 'streaming'; if (current === attempt) render();
    const recorded = stream.pipeThrough(new TransformStream({ transform(frame, destination) {
      attempt.frames.push(stamp(attempt, structuredClone(frame)) as Timed<UIMessageChunk>); destination.enqueue(frame);
    } }));
    for await (const snapshot of readUIMessageStream<Message>({ stream: recorded,
      onError: error => { attempt.sdkErrors.push(observed(error)); } })) {
      attempt.snapshots.push(structuredClone(snapshot)); attempt.message = snapshot;
      if (current === attempt) render();
    }
    attempt.clientState = attempt.controller.signal.aborted ? 'local-stopped'
      : attempt.sdkErrors.length ? 'failed' : attempt.message?.metadata?.state === 'completed' ? 'completed' : 'ended';
    if (current === attempt && attempt.clientState === 'completed' && attempt.message) previous = {
      requestId: attempt.requestId, fixtureKey, input: attempt.input, message: structuredClone(attempt.message), endedAt: new Date().toISOString(),
    };
  } catch (error) {
    attempt.transportError = observed(error);
    attempt.rejectedBeforeModel = APICallError.isInstance(error) && error.statusCode === 400;
    attempt.clientState = attempt.controller.signal.aborted ? 'local-stopped' : 'failed';
  } finally {
    attempt.endedAt = new Date().toISOString();
    if (current === attempt) { busy = false; render(); }
  }
}

async function stop() {
  const attempt = current;
  if (!attempt || !busy || reading || attempt.stopRequestedAt) return;
  attempt.stopRequestedAt = new Date().toISOString();
  attempt.actions.push(stamp(attempt, { kind: 'user-stop' })); render();
  try {
    const response = await fetch(`/api/requests/${attempt.requestId}/cancel`, { method: 'POST' });
    const body: unknown = await response.json();
    attempt.cancelReceipt = { status: response.status, headers: Object.fromEntries(response.headers), body };
  } catch (error) { attempt.cancelReceipt = { error: observed(error) }; }
  finally {
    attempt.controller.abort(new DOMException('用户停止本地HTTP消费', 'AbortError'));
    attempt.actions.push(stamp(attempt, { kind: 'local-consumption-abort', signal: observed(attempt.controller.signal) }));
    if (current === attempt) render();
  }
}

async function inspect() {
  const attempt = current;
  if (!attempt || busy) return;
  busy = true; reading = true; attempt.actions.push(stamp(attempt, { kind: 'user-read-same-request' })); render();
  try {
    const response = await fetch(`/api/requests/${attempt.requestId}`);
    const body = await response.json() as RequestRecord;
    attempt.readReceipts.push({ at: new Date().toISOString(), status: response.status, headers: Object.fromEntries(response.headers), body });
    if (!response.ok) throw new Error(`本次记录读取HTTP ${response.status}`);
    if (body.requestId !== attempt.requestId || body.input !== attempt.input || body.fixtureKey !== attempt.fixtureKey) throw new Error('读回记录与本次完整输入不同，不能接到当前任务。');
    attempt.serverRecord = body;
  } catch (error) { attempt.readReceipts.push({ at: new Date().toISOString(), error: observed(error) }); }
  finally { if (current === attempt) { busy = false; reading = false; render(); } }
}

get('run').addEventListener('click', () => { if (!catalog) void load(); else if (current && needsConfirmation(current)) void inspect(); else void run(); });
get('stop').addEventListener('click', () => { void stop(); });
get('inspect').addEventListener('click', () => { void inspect(); });
fixtureChoice.addEventListener('change', () => { if (catalog && !busy) textarea.value = catalog.fixtures[fixtureChoice.value as FixtureKey].input; });
get('download').addEventListener('click', () => {
  const body = { origin: '当前受控页面的真实HTTP消费与手工动作记录，未运行新云模型', serviceId: catalog?.serviceId, sourceVersion: catalog?.sourceVersion,
    currentRequestId: current?.requestId ?? null,
    inputDraft: textarea.value, previous, attempts: attempts.map(publicAttempt) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `受控请求页面-${current?.requestId ?? '未提交'}.json`; link.click(); URL.revokeObjectURL(url);
});
void load();
