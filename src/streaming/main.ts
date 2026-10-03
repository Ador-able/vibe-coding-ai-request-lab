import './style.css';
import './replay.css';
import { readUIMessageStream, simulateReadableStream } from 'ai';
import { MATERIAL } from './material.ts';
import type { AssistantMessage, Chunk, RunRecord } from './contract.ts';

const fixtures = [
  { label: '完整结束记录', id: '1153e17e-e0b4-4870-978f-bf0eca94b0fb',
    sha256: 'ba1c2ad1f410c978b598eb8948d73240d1a46f6015a3f1c44b27ae6602c33638' },
  { label: '中途停止记录', id: 'f7f927eb-9faa-49d4-af68-fe3429ed2e67',
    sha256: '4f54884f3dddde0041ac586304ebc70342593fdd2bdd3f9b042166b0f816a17b' },
] as const;
type PlaybackState = 'reading' | 'finished' | 'interrupted' | 'failed';
type Playback = {
  playbackId: string; fixtureIndex: number; state: PlaybackState;
  startedAt: string; endedAt: string | null; error: string | null;
  sourceBytes: Uint8Array<ArrayBuffer> | null; sourceText: string; historical: RunRecord | null;
  message: AssistantMessage | null; snapshots: AssistantMessage[];
  events: { historicalSequence: number; historicalElapsedMs: number; replayElapsedMs: number; event: Chunk }[];
  sdkErrors: string[];
};

document.querySelector<HTMLElement>('#app')!.innerHTML = `
  <header><div class="heading-top"><h1>纪要整理</h1><label class="direction-label" for="direction">页面方向<select id="direction"><option value="original">原版</option><option value="studio">台面</option><option value="notebook">笔记页</option></select></label></div><p class="replay-note">历史事件回放，不调用模型</p></header>
  <div class="workspace"><section id="source">
    <label for="material">工作纪要（教学虚构）</label><textarea id="material" rows="4" readonly></textarea>
    <div class="source-controls"><label for="fixture">历史记录<select id="fixture"></select></label></div>
    <div class="actions"><button id="run">回放选中记录</button><button id="stop" class="secondary" hidden>停止回放</button></div>
    <p id="status" role="status" aria-live="polite"></p>
  </section>
  <section id="assistant" hidden><div class="message-heading"><h2>助手回复</h2><span id="progress" class="progress" role="status" aria-live="polite"></span></div><div id="message"></div></section>
  <details id="records" hidden><summary>查看事件与请求记录</summary><div class="inspector-body">
    <div class="record-tools"><label for="attempt">回放<select id="attempt"></select></label><label for="event-view">事件<select id="event-view"><option value="boundaries">阶段与结束</option><option value="all">全部（含文字增量）</option></select></label><button id="download-source" class="secondary">下载历史原件</button><button id="download-observation" class="secondary">下载本次观察</button></div>
    <p id="record-label" class="note"></p><p id="identity" class="note"></p><p id="metadata" class="note"></p>
    <div class="table-scroll"><table><thead><tr><th>历史顺序 / 毫秒</th><th>UI事件</th><th>内容</th></tr></thead><tbody id="events"></tbody></table></div>
    <details><summary>历史原始数据与记录口径</summary><div class="record-explanation"><p id="model" class="note"></p><p class="note">表中是本次已读取的历史UI事件，编号、ID和毫秒来自原记录。120毫秒回放间隔只用于观察，不代表历史网络时间。</p><p class="note">原件包含实际请求体、供应商JSON片段和完整已收文字，不含SSE线分隔或[DONE]字节。未知用量保留为null；消息进度不代表数据库保存或内容采用。</p></div><pre id="raw-record"></pre></details>
    <details><summary>本次回放的完整观察</summary><pre id="raw-playback"></pre></details>
  </div></details></div>`;
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
get<HTMLTextAreaElement>('material').value = MATERIAL;
get<HTMLSelectElement>('fixture').replaceChildren(...fixtures.map((entry, index) => new Option(entry.label, String(index))));
document.body.dataset.direction = 'original';

const playbacks: Playback[] = [];
let current = -1;
let busy = false;
let controller: AbortController | null = null;
let notice = '';
let noticeIsError = false;
const playbackLabel = { reading: '读取中', finished: '读取结束', interrupted: '本次中止', failed: '本次失败' };
const historicalLabel = { running: '进行中', completed: '生成流程已结束', stopped: '已停止，未完成', failed: '失败，未完成' };

function eventDescription(event: Chunk) {
  if (event.type === 'text-delta') return `${event.id}：${event.delta}`;
  if (event.type === 'data-progress') return `${event.id} → ${event.data.label}`;
  if (event.type === 'start') return `历史消息 ${event.messageId}`;
  if (event.type === 'text-start' || event.type === 'text-end') return event.id;
  if (event.type === 'finish') return `整条消息结束 · ${event.finishReason}`;
  if (event.type === 'error') return event.errorText;
  if (event.type === 'abort') return event.reason || '历史中止';
  if (event.type === 'message-metadata') return '更新这一条消息的状态、型号与阶段用量';
  if (event.type === 'finish-step') return '历史模型步骤结束';
  if (event.type === 'start-step') return '历史模型步骤开始';
  return event.type;
}
function observation(playback: Playback) {
  const fixture = fixtures[playback.fixtureIndex]!;
  const start = playback.historical?.uiEvents.find(({ event }) => event.type === 'start')?.event;
  return {
    playbackId: playback.playbackId,
    scope: '零模型历史事件回放；本次中止不改历史任务状态。',
    fixtureFile: `${fixture.id}.json`, expectedSourceSha256: fixture.sha256,
    historicalRunId: playback.historical?.id ?? null,
    historicalStartMessageId: start?.type === 'start' ? start.messageId : null,
    returnedMessageId: playback.message?.id ?? null,
    historicalState: playback.historical?.state ?? null,
    playbackState: playback.state, startedAt: playback.startedAt, endedAt: playback.endedAt,
    replayIntervalMs: 120, error: playback.error, sdkErrors: playback.sdkErrors,
    actualEventsRead: playback.events, snapshots: playback.snapshots,
    finalSnapshot: playback.message,
  };
}
function statusText(playback: Playback) {
  if (playback.state === 'reading') return '正在读取历史事件…';
  if (playback.state === 'interrupted') return '本次回放已中止，已读片段保留；历史记录未改。';
  if (playback.state === 'failed') return playback.error || '本次读取失败，已读片段保留。';
  if (playback.message?.metadata?.state === 'stopped') return '回放结束；历史任务未完成。';
  if (playback.message?.metadata?.state === 'completed') return '回放结束；历史生成流程已结束，内容仍需核对。';
  return '回放结束，请核对历史结束边界。';
}
function render() {
  const playback = playbacks[current];
  get<HTMLButtonElement>('run').disabled = busy;
  get<HTMLSelectElement>('fixture').disabled = busy;
  get('stop').hidden = !busy;
  get<HTMLButtonElement>('stop').disabled = controller?.signal.aborted ?? false;
  get('status').textContent = notice || (playback ? statusText(playback) : '');
  get('status').className = noticeIsError || playback?.state === 'failed' ? 'error' : '';
  get('assistant').hidden = !playback?.message;
  get('records').hidden = !playback;
  const choice = get<HTMLSelectElement>('attempt');
  choice.replaceChildren(...playbacks.map((item, index) => new Option(`第${index + 1}次 · ${playbackLabel[item.state]}`, String(index))));
  choice.value = String(current); choice.disabled = busy;
  get<HTMLButtonElement>('download-source').disabled = busy || !playback?.sourceBytes;
  get<HTMLButtonElement>('download-observation').disabled = busy || !playback;
  if (!playback) return;

  const progress = playback.message?.parts.find(part => part.type === 'data-progress');
  get('progress').textContent = progress?.type === 'data-progress' ? `历史进度：${progress.data.label}` : '';
  const content = get('message'); content.replaceChildren();
  const textParts = playback.message?.parts.filter(part => part.type === 'text') ?? [];
  textParts.forEach((part, index) => {
    const section = document.createElement('section');
    const heading = document.createElement('h3'); heading.textContent = index === 0 ? '摘要' : '待确认问题';
    const state = document.createElement('span'); state.className = 'text-state';
    state.textContent = part.state === 'done' ? '已结束' : '未完整结束'; heading.append(state);
    const text = document.createElement('p'); text.className = 'answer';
    text.textContent = part.text || '等待正文片段…'; section.append(heading, text); content.append(section);
  });
  const metadata = playback.message?.metadata;
  get('metadata').textContent = metadata
    ? `消息metadata：${historicalLabel[metadata.state]} · ${metadata.model} · ${metadata.stages.map(stage => `${stage.stage === 'summary' ? '摘要' : '问题'}结束原因 ${stage.finishReason ?? '未知'}，用量 ${stage.usage === null ? '未知' : JSON.stringify(stage.usage)}`).join('；')}` : '';
  const showAll = get<HTMLSelectElement>('event-view').value === 'all';
  get('record-label').textContent = `本次${playbackLabel[playback.state]} · 已读${playback.events.length}/${playback.historical?.uiEvents.length ?? '未知'}条历史UI事件${showAll ? '' : '，当前隐藏文字增量'}`;
  get('identity').textContent = `本次回放 ${playback.playbackId}；历史运行 ${playback.historical?.id ?? '未载入'}；消息 ${playback.message?.id ?? '尚未返回'}。`;
  get('model').textContent = playback.historical
    ? `历史任务：${historicalLabel[playback.historical.state]}；两阶段实际调用 ${playback.historical.stages.map(stage => stage.responseModel ?? '未知型号').join('、')}。本次没有模型调用。` : '本次未载入历史原件。';
  const rows = get('events'); rows.replaceChildren();
  playback.events.forEach(({ historicalSequence, historicalElapsedMs, event }) => {
    if (!showAll && event.type === 'text-delta') return;
    const row = document.createElement('tr');
    for (const value of [`${historicalSequence} / ${historicalElapsedMs}`, event.type, eventDescription(event)]) {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    }
    rows.append(row);
  });
  get('raw-record').textContent = playback.sourceText || '没有历史原件；实际读取失败见本次观察。';
  get('raw-playback').textContent = JSON.stringify(observation(playback), null, 2);
}

get('run').addEventListener('click', async () => {
  if (busy) return;
  const fixtureIndex = Number(get<HTMLSelectElement>('fixture').value);
  const fixture = fixtures[fixtureIndex]!;
  const previous = current;
  const playback: Playback = {
    playbackId: crypto.randomUUID(), fixtureIndex, state: 'reading',
    startedAt: new Date().toISOString(), endedAt: null, error: null,
    sourceBytes: null, sourceText: '', historical: null, message: null, snapshots: [], events: [], sdkErrors: [],
  };
  playbacks.push(playback);
  const index = playbacks.length - 1;
  const signalController = new AbortController(); controller = signalController;
  busy = true; notice = '正在载入历史原件…'; noticeIsError = false; render();
  const startTime = performance.now();
  try {
    const response = await fetch(`/streaming-history/${fixture.id}.json`, { signal: signalController.signal });
    if (!response.ok) throw new Error(`历史原件载入失败（HTTP ${response.status}）。`);
    const buffer = await response.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (digest !== fixture.sha256) throw new Error('历史原件字节与固定材料不一致，未开始读取。');
    playback.sourceBytes = new Uint8Array(buffer);
    playback.sourceText = new TextDecoder().decode(buffer);
    playback.historical = JSON.parse(playback.sourceText) as RunRecord;
    current = index; notice = ''; render();

    // 消费副本，保持原件与收到时的事件历史不受SDK对象更新影响。
    const historicalEvents = playback.historical.uiEvents;
    const source = simulateReadableStream({ chunks: structuredClone(historicalEvents.map(({ event }) => event)), initialDelayInMs: null, chunkDelayInMs: 120 });
    const recorded = source.pipeThrough(new TransformStream<Chunk, Chunk>({ transform(chunk, streamController) {
      const position = playback.events.length;
      playback.events.push({ historicalSequence: position + 1, historicalElapsedMs: historicalEvents[position]!.elapsedMs,
        replayElapsedMs: Math.round((performance.now() - startTime) * 10) / 10, event: structuredClone(chunk) });
      streamController.enqueue(chunk);
    } }), { signal: signalController.signal });
    // SDK给完整消息快照；页面采用最新值，不把每次全文再追加。
    for await (const message of readUIMessageStream<AssistantMessage>({ stream: recorded, onError: error => {
      playback.sdkErrors.push(error instanceof Error ? error.message : String(error));
    } })) {
      playback.message = message; playback.snapshots.push(structuredClone(message)); render();
    }
    playback.state = signalController.signal.aborted ? 'interrupted' : playback.sdkErrors.length ? 'failed' : 'finished';
    if (playback.state === 'failed') playback.error = 'SDK读取失败，已读片段保留；没有自动重试。';
  } catch (error) {
    playback.state = signalController.signal.aborted ? 'interrupted' : 'failed';
    playback.error = error instanceof Error ? error.message : String(error);
    if (!playback.historical && previous >= 0) {
      current = previous;
      notice = playback.state === 'interrupted' ? '本次载入已中止，上一份回放仍可查看。' : `${playback.error} 上一份回放仍可查看。`;
      noticeIsError = playback.state === 'failed';
    } else current = index;
  } finally {
    playback.endedAt = new Date().toISOString(); busy = false; controller = null; render();
  }
});
get('stop').addEventListener('click', () => { if (busy) { controller?.abort(); render(); } });
get('direction').addEventListener('change', () => { document.body.dataset.direction = get<HTMLSelectElement>('direction').value; });
get('attempt').addEventListener('change', () => { current = Number(get<HTMLSelectElement>('attempt').value); notice = ''; noticeIsError = false; render(); });
get('event-view').addEventListener('change', render);
function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
get('download-source').addEventListener('click', () => {
  const playback = playbacks[current]; if (!playback?.sourceBytes) return;
  download(new Blob([playback.sourceBytes], { type: 'application/json' }), `${fixtures[playback.fixtureIndex]!.id}.json`);
});
get('download-observation').addEventListener('click', () => {
  const playback = playbacks[current]; if (!playback) return;
  download(new Blob([JSON.stringify(observation(playback), null, 2)], { type: 'application/json' }), `历史回放观察-${playback.playbackId}.json`);
});
render();
