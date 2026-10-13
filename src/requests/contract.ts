import type { UIMessage, UIMessageChunk } from 'ai';

export type FixtureKey = 'A' | 'B';
export type Scenario = 'normal' | 'permission' | 'retry-before-stream' | 'timeout' | 'error-during-stream' | 'disconnect';
export type State = 'running' | 'completed' | 'cancelled' | 'timed-out' | 'failed';
export type Cause = 'manual-stop' | 'connection-closed' | 'timeout' | 'provider-error' | 'processing-error';
export type Timed<T> = { at: string; elapsedMs: number; value: T };
export type Metadata = { requestId: string; fixtureKey: FixtureKey; state: State; cause: Cause | null; origin: 'controlled-exercise' };
export type Message = UIMessage<Metadata>;

export type Fixture = {
  key: FixtureKey; title: string; instructions: string; input: string;
  answer: string; deltas: string[]; answerOrigin: string; source: unknown;
};
export type Catalog = { sdkVersion: string; fixtures: Record<FixtureKey, Fixture>; scenarios: Array<{ key: Scenario; label: string }>; files: Array<{ file: string; bytes: number; sha256: string }> };
export type ProviderCall = {
  index: number; beganAt: string; elapsedMs: number; input: unknown;
  result: 'pending' | 'stream' | 'threw'; error?: unknown;
  assignedParts: unknown; emittedParts: Array<Timed<unknown>>;
  signalChanges: Array<Timed<unknown>>;
};
export type RequestRecord = {
  requestId: string; serviceId: string; fixtureKey: FixtureKey; scenario: Scenario;
  input: string; instructions: string; answerOrigin: string; source: unknown;
  sdkOptions: { maxRetries: number; streamRetries: 'omitted'; totalTimeoutMs: number };
  startedAt: string; state: State; cause: Cause | null; finishedAt: string | null;
  manualStopRequestedAt: string | null; connectionClosedAt: string | null;
  providerCalls: ProviderCall[]; sdkParts: Array<Timed<unknown>>;
  callbacks: Array<Timed<{ kind: string; event: unknown }>>;
  uiEvents: Array<Timed<UIMessageChunk>>; transport: Array<Timed<unknown>>;
  serverSseProduced: Array<Timed<string>>;
  uiMessage: Message | null; uiOutcome: unknown; error: unknown;
};

export const SCENARIOS: Catalog['scenarios'] = [
  { key: 'normal', label: '正常慢流（可手动停止）' },
  { key: 'permission', label: '开始前模拟401' },
  { key: 'retry-before-stream', label: '开始前模拟503，再由SDK有限重试' },
  { key: 'timeout', label: '总等待预算1200毫秒' },
  { key: 'error-during-stream', label: '已有片段后模拟503' },
  { key: 'disconnect', label: '真实中断本机HTTP连接' },
];

export function terminal(state: State): boolean { return state !== 'running'; }

// 记录可观察值；不可JSON化的值有明确标记，不伪装成空对象。
export function observed(value: unknown, active = new Set<object>()): unknown {
  if (value === undefined) return { kind: 'undefined' };
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return { kind: 'bigint', value: String(value) };
  if (typeof value === 'function') return { kind: 'function', name: value.name };
  if (typeof value === 'symbol') return { kind: 'symbol', description: value.description };
  if (value instanceof Date) return { kind: 'Date', value: value.toISOString() };
  if (value instanceof AbortSignal) return { kind: 'AbortSignal', aborted: value.aborted, reason: observed(value.reason, active) };
  if (value instanceof ReadableStream) return { kind: 'ReadableStream', locked: value.locked, note: '流对象不能JSON化，分段另外完整记录' };
  if (active.has(value as object)) return { kind: 'circular-reference' };
  active.add(value as object);
  let result: unknown;
  if (value instanceof Error || value instanceof DOMException) {
    const fields = Object.fromEntries(Object.getOwnPropertyNames(value).filter(key => key !== 'stack')
      .map(key => [key, observed((value as unknown as Record<string, unknown>)[key], active)]));
    result = { kind: 'Error', name: value.name, message: value.message, ...fields,
      stack: typeof value.stack === 'string' ? value.stack : { kind: 'undefined' } };
  } else if (Array.isArray(value)) {
    result = value.map(item => observed(item, active));
  } else {
    result = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, observed(item, active)]));
  }
  active.delete(value as object);
  return result;
}
