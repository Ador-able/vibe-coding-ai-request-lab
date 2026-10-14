import './style.css';
import type { Catalog, CompletionState, Conversation, ConversationView, FixtureKey, Message, PreparedInput } from './contract.ts';

type Phase = 'user' | 'snapshotEarly' | 'snapshotLater' | 'final';
type ApiReceipt = { at: string; url: string; method: string; requestBody: unknown;
  status: number | null; responseBody: unknown; error?: string };
class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const fixtureSelect = element<HTMLSelectElement>('fixture');
const phaseSelect = element<HTMLSelectElement>('phase');
const noteInput = element<HTMLTextAreaElement>('note');
const importButton = element<HTMLButtonElement>('import');
const saveButton = element<HTMLButtonElement>('save-feedback');
const reloadButton = element<HTMLButtonElement>('reload');
const prepareButton = element<HTMLButtonElement>('prepare');
const savedSelect = element<HTMLSelectElement>('saved-conversation');
const openButton = element<HTMLButtonElement>('open-record');
const receipts: ApiReceipt[] = [];
let catalog: Catalog | undefined;
let current: ConversationView | undefined;
let prepared: PreparedInput | undefined;
let busy = false;
let draft = '';
let dirty = false;
let readRequired = false;
let statusText = '正在读取导入材料。';
let statusError = false;

function observation() {
  return { nextFixture: fixtureSelect.value, nextPhase: phaseSelect.value,
    busy, draft: { text: draft, dirty, readRequired }, statusText, statusError,
    current: current ?? null, prepared: prepared ?? null, catalog: catalog ?? null, requests: receipts };
}
declare global { interface Window { messageHistoryObservation: () => ReturnType<typeof observation>; } }
window.messageHistoryObservation = () => structuredClone(observation());

async function api<T>(url: string, body?: unknown): Promise<T> {
  const receipt: ApiReceipt = { at: new Date().toISOString(), url,
    method: body === undefined ? 'GET' : 'POST', requestBody: body ?? null, status: null, responseBody: null };
  try {
    const response = await fetch(url, { method: receipt.method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    receipt.status = response.status;
    receipt.responseBody = await response.json();
    if (!response.ok) {
      const error = receipt.responseBody as { code?: string; message?: string };
      throw new ApiError(error.code ?? 'REQUEST_FAILED', error.message ?? '本次操作未能确认。');
    }
    return receipt.responseBody as T;
  } catch (error) {
    receipt.error = String(error);
    throw error;
  } finally { receipts.push(receipt); }
}

function activeFixture() {
  return catalog?.fixtures.find(fixture => fixture.sourceRecordId === current?.conversation.sourceRecordId)
    ?? catalog?.fixtures.find(fixture => fixture.key === fixtureSelect.value);
}
function reviewText(message?: Message): string | undefined {
  const part = message?.parts.find(item => item.type === 'data-review-note');
  return part?.type === 'data-review-note' ? part.data.text : undefined;
}
function savedReview(): string | undefined {
  return reviewText(current?.messages.find(message => message.parts.some(part => part.type === 'data-review-note')));
}
function sourceUser(): Message | undefined {
  return current?.messages.find(message => message.role === 'user') ?? activeFixture()?.userMessage;
}
function textOf(message?: Message): string {
  return message?.parts.filter(part => part.type === 'text').map(part => part.text).join('\n\n') ?? '';
}
function setStatus(message: string, error = false): void { statusText = message; statusError = error; }
function updatePhases(key: FixtureKey, value: Phase = 'user'): void {
  const phases = catalog?.fixtures.find(fixture => fixture.key === key)?.phases ?? [];
  phaseSelect.replaceChildren(...(['user', ...phases] as Phase[]).map(phase => {
    const option = document.createElement('option');
    option.value = phase;
    option.textContent = ({ user: '用户材料', snapshotEarly: '较早快照', snapshotLater: '后续快照', final: '完整回显消息' })[phase];
    return option;
  }));
  phaseSelect.value = value;
}
function chooseCurrent(view: ConversationView, resetDraft = false): void {
  current = view;
  prepared = undefined;
  if (resetDraft) draft = savedReview() ?? reviewText(activeFixture()?.feedbackMessage) ?? '';
  dirty = draft !== savedReview();
  readRequired = false;
  const url = new URL(location.href);
  url.searchParams.set('conversation', view.conversation.id);
  history.replaceState(null, '', url);
}

function stateName(state: CompletionState | undefined): string {
  return ({ submitted: '用户材料已保存', incomplete: '原快照未完成', completed: '原文回显完整接收', stopped: '受控接收已停止 · 未完成' })[state ?? 'submitted'];
}
function addText(parent: HTMLElement, className: string, text: string, tag = 'p'): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}
function renderAssistant(): void {
  const message = current?.messages.find(item => item.role === 'assistant');
  const parent = element('assistant');
  parent.replaceChildren();
  const entry = current?.entries.find(item => item.messageId === message?.id);
  element('completion').textContent = !current ? '尚未保存' : message ? stateName(entry?.completionState) : '用户材料已保存';
  element('historical-progress').textContent = '';
  if (!message) {
    addText(parent, 'empty', '先保存用户材料，再导入同一助手消息的快照或完整原件。');
    return;
  }
  const progress = message.parts.find(part => part.type === 'data-progress');
  if (progress?.type === 'data-progress') element('historical-progress').textContent = `原记录进度：${progress.data.label}`;
  const texts = message.parts.filter(part => part.type === 'text');
  for (const [index, part] of texts.entries()) {
    const section = document.createElement('section');
    addText(section, 'answer-heading', `原文回显片段 ${index + 1}`, 'h3');
    addText(section, 'answer', part.text);
    addText(section, 'part-state', `原片段状态：${part.state ?? '未提供'}`);
    parent.append(section);
  }
}
function renderPrepared(): void {
  element('prepared').hidden = !prepared;
  const parent = element('input-readable');
  parent.replaceChildren();
  if (!prepared) return;
  addText(parent, 'input-role', '本轮规则', 'h3');
  addText(parent, 'prose', prepared.nextInput.system);
  if (prepared.excluded.length) addText(parent, 'quiet', `本轮未选入${prepared.excluded.length}条未完成助手消息。原件仍保存在库中，身份和理由见完整对象。`);
  for (const [index, message] of prepared.nextInput.messages.entries()) {
    const section = document.createElement('section');
    addText(section, 'input-role', `${index + 1} · ${message.role}`, 'h3');
    if (typeof message.content === 'string') addText(section, 'prose', message.content);
    else for (const part of message.content) {
      if (part.type === 'text') addText(section, 'prose', part.text);
      else addText(section, 'prose', JSON.stringify(part, null, 2));
    }
    parent.append(section);
  }
}

function render(): void {
  const fixture = activeFixture();
  element('source-heading').textContent = current ? '已保存的用户材料' : '导入用材料（未保存）';
  element('user-task').textContent = textOf(sourceUser());
  element('history-heading').textContent = current?.messages.some(message => message.role === 'assistant') ? '已保存的助手消息' : '当前记录';
  renderAssistant();
  element('record-identity').textContent = current ? `${current.messages.length}条已保存消息 · 会话 ${current.conversation.id.slice(0, 8)}` : '';
  element('review-state').textContent = readRequired ? '保存待确认' : dirty ? '未保存' : savedReview() === undefined ? '未保存' : '已保存并读回';
  if (noteInput.value !== draft) noteInput.value = draft;
  const assistant = current?.messages.find(message => message.role === 'assistant');
  const currentKeyMatches = fixture?.key === fixtureSelect.value;
  const creating = phaseSelect.value === 'user';
  const entry = current?.entries.find(item => item.messageId === assistant?.id);
  const finalAlreadySaved = phaseSelect.value === 'final' && currentKeyMatches
    && (entry?.completionState === 'completed' || entry?.completionState === 'stopped');
  importButton.disabled = busy || readRequired || (!creating && (!current || !currentKeyMatches)) || finalAlreadySaved;
  const reviewing = !!assistant && currentKeyMatches && finalAlreadySaved;
  importButton.classList.toggle('secondary', reviewing);
  saveButton.classList.toggle('secondary', !reviewing);
  saveButton.disabled = busy || readRequired || !assistant || !dirty || !draft.trim();
  noteInput.disabled = busy || !assistant;
  prepareButton.disabled = busy || readRequired || !assistant || dirty || savedReview() === undefined || !!prepared;
  reloadButton.disabled = busy || !current;
  fixtureSelect.disabled = busy;
  phaseSelect.disabled = busy;
  savedSelect.disabled = busy;
  openButton.disabled = busy || !savedSelect.value;
  element('status').textContent = statusText;
  element('status').classList.toggle('error', statusError);
  element('raw-view').textContent = current ? JSON.stringify(current, null, 2) : '尚未保存记录。';
  element('raw-prepared').textContent = prepared ? JSON.stringify(prepared, null, 2) : '尚未准备输入。';
  element('raw-requests').textContent = JSON.stringify(receipts, null, 2);
  element('raw-catalog').textContent = JSON.stringify(catalog ?? {}, null, 2);
  renderPrepared();
}

async function operation(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  render();
  try { await action(); }
  catch (error) { setStatus(error instanceof ApiError ? error.message : '连接未能确认，请重新读取记录。输入仍保留。', true); }
  finally { busy = false; render(); }
}

async function updateList(): Promise<void> {
  const saved = await api<Conversation[]>('/api/messages/conversations');
  savedSelect.replaceChildren(new Option('选择记录', ''), ...saved.map(item => {
    const key = catalog?.fixtures.find(fixture => fixture.sourceRecordId === item.sourceRecordId)?.key;
    return new Option(`${key === 'stopped' ? '停止记录' : '完整记录'} · ${item.id}`, item.id);
  }));
}

importButton.addEventListener('click', () => void operation(async () => {
  prepared = undefined;
  setStatus('正在保存并独立读回。');
  const creating = phaseSelect.value === 'user';
  const phase = phaseSelect.value as Phase;
  const response = creating
    ? await api<{ view: ConversationView }>('/api/messages/conversations', { fixtureKey: fixtureSelect.value })
    : await api<{ view: ConversationView }>(`/api/messages/conversations/${current!.conversation.id}/import`, { phase });
  // 先保留保存回执中的身份；GET 失败时仍能重新读取，不丢失新会话入口。
  current = response.view;
  if (creating) { draft = reviewText(activeFixture()?.feedbackMessage) ?? ''; dirty = true; }
  readRequired = true;
  const url = new URL(location.href);
  url.searchParams.set('conversation', current.conversation.id);
  history.replaceState(null, '', url);
  if (creating) updatePhases(fixtureSelect.value as FixtureKey, fixtureSelect.value === 'normal' ? 'snapshotEarly' : 'final');
  else if (phase === 'snapshotEarly') phaseSelect.value = 'snapshotLater';
  else if (phase === 'snapshotLater') phaseSelect.value = 'final';
  const view = await api<ConversationView>(`/api/messages/conversations/${current.conversation.id}`);
  chooseCurrent(view, creating);
  setStatus('消息已保存，并由独立 GET 读回。');
  await updateList();
}));

saveButton.addEventListener('click', () => void operation(async () => {
  const submittedNote = draft;
  prepared = undefined;
  setStatus('正在保存校正并读回。');
  try {
    await api(`/api/messages/conversations/${current!.conversation.id}/feedback`, { note: submittedNote });
    readRequired = true;
    const view = await api<ConversationView>(`/api/messages/conversations/${current!.conversation.id}`);
    chooseCurrent(view);
    if (savedReview() !== submittedNote) throw new ApiError('READBACK_DIFFERS', '读回校正与本次输入不同，请核对完整记录。');
    setStatus('校正已保存并读回，尚未发给模型。');
  } catch (error) {
    dirty = true;
    readRequired = !(error instanceof ApiError && error.code === 'SAVE_LOCKED');
    throw error;
  }
}));

reloadButton.addEventListener('click', () => void operation(async () => {
  const view = await api<ConversationView>(`/api/messages/conversations/${current!.conversation.id}`);
  chooseCurrent(view);
  setStatus(dirty ? '已重新读取；未保存的校正仍保留。' : '已从数据库重新读取完整记录。');
}));

prepareButton.addEventListener('click', () => void operation(async () => {
  setStatus('正在校验并转换已保存消息。');
  prepared = await api<PreparedInput>(`/api/messages/conversations/${current!.conversation.id}/prepare`, {});
  setStatus('P0、P1、P2 已准备。仅 P2 是本轮选定输入，尚未调用模型。');
}));

noteInput.addEventListener('input', () => {
  draft = noteInput.value;
  dirty = draft !== savedReview();
  prepared = undefined;
  render();
});
fixtureSelect.addEventListener('change', () => { updatePhases(fixtureSelect.value as FixtureKey); render(); });
phaseSelect.addEventListener('change', render);
savedSelect.addEventListener('change', render);
openButton.addEventListener('click', () => void operation(async () => {
  chooseCurrent(await api<ConversationView>(`/api/messages/conversations/${savedSelect.value}`), true);
  fixtureSelect.value = activeFixture()!.key;
  updatePhases(fixtureSelect.value as FixtureKey, 'final');
  setStatus('已读取选中记录；没有运行模型。');
}));
element('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(observation(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `消息观察-${current?.conversation.id ?? '未保存'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

void operation(async () => {
  catalog = await api<Catalog>('/api/messages/catalog');
  updatePhases('normal');
  const id = new URL(location.href).searchParams.get('conversation');
  if (id) {
    chooseCurrent(await api<ConversationView>(`/api/messages/conversations/${encodeURIComponent(id)}`), true);
    fixtureSelect.value = activeFixture()!.key;
    updatePhases(fixtureSelect.value as FixtureKey, 'final');
    setStatus('已从数据库读取完整记录，没有运行模型。');
  } else setStatus('材料尚未保存。先装入用户材料。');
  await updateList();
});
