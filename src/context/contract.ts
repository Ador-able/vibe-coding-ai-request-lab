export type Condition = 'current' | 'chat' | 'full';

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type RequestRecord = {
  step: string;
  startedAt: string;
  requestBody: string;
  durationMs?: number;
  httpStatus?: number;
  responseModel?: string;
  finishReason?: string | null;
  usage?: unknown;
  responseMessage?: unknown;
  error?: string;
};

export type ToolExecution = {
  callId: string;
  name: string;
  arguments: string;
  result: string;
};

export type ExperimentRun = {
  id: string;
  label: string;
  condition?: Condition;
  startedAt: string;
  answer: string | null;
  requests: RequestRecord[];
  tools: ToolExecution[];
  error?: { code: string; message: string };
};

export type ContextResponse = {
  ok: boolean;
  run: ExperimentRun;
  sessionId?: string;
  firstRound?: ExperimentRun;
  runs?: ExperimentRun[];
};

export const CONDITIONS: Record<Condition, { name: string; description: string }> = {
  current: { name: '仅本轮问题', description: '不发送上轮聊天，也不发送工具结果。' },
  chat: { name: '保留聊天文字', description: '发送上轮用户问题和助手文字，去掉工具调用及结果。' },
  full: { name: '保留完整历史', description: '聊天文字、助手工具调用、工具结果全部保留。' },
};

export const FIRST_QUESTION = 'release-2026-09-28 的发布时间是什么？请只回答发布时间。';
export const FOLLOW_UP = '这个版本的负责人是谁？';
