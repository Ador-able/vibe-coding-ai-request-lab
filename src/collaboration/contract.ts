import type { RequestRecord } from '../context/contract.ts';

export type Turn = { input: string; answer: string };
export type CollaborationResult = {
  id: string;
  round: number;
  input: string;
  answer: string | null;
  request: RequestRecord | null;
  error?: { code: string; message: string };
};
export type CollaborationResponse = { ok: boolean; result: CollaborationResult };

// 只有完整成功的回答进入下一轮上下文；失败尝试仍由页面单独保留。
export function acceptTurn(history: Turn[], result: CollaborationResult): Turn[] {
  return result.error || result.answer === null ? history : [...history, { input: result.input, answer: result.answer }];
}
