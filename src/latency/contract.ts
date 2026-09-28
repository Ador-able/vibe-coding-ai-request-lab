import type { ErrorCode } from '../contract.ts';
import type { Condition } from './materials.ts';

export type StreamEvent = { elapsedMs: number; data: string; event?: string; id?: string };
export type StreamRecord = {
  id: string;
  condition: Condition;
  startedAt: string;
  requestBody: string;
  responseModel: string | null;
  httpStatus: number | null;
  events: StreamEvent[];
  answer: string;
  firstContentMs: number | null;
  streamEndMs: number | null;
  endedBy: 'done' | 'eof' | null;
  finishReason: string | null;
  usage: unknown;
  error?: { code: ErrorCode; message: string };
};
export type ClientEvent =
  | { type: 'start'; record: StreamRecord }
  | { type: 'delta'; text: string; elapsedMs: number }
  | { type: 'complete'; record: StreamRecord };

export function usageOf(usage: unknown) {
  const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
  const count = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  const data = object(usage) ? usage : {};
  const details = object(data.prompt_tokens_details) ? data.prompt_tokens_details : {};
  // 缺少 cached_tokens 不能推断为未命中；它是输入用量的一部分，不另加总数。
  return { input: count(data.prompt_tokens), output: count(data.completion_tokens), cached: count(details.cached_tokens) };
}
