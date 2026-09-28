import type { RequestRecord } from '../context/contract.ts';
import type { TEACHING_NOTE } from './materials.ts';
export type Flow = 'full' | 'retrieve' | 'summary' | 'note';
export const FLOWS: Record<Flow, string> = { full: '全文回答', retrieve: '按需读取后回答', summary: '压缩后回答', note: '新会话读取便笺与原文' };
export type SavedNote = { origin: 'reader-confirmed-teaching-note'; confirmedAt: string; note: typeof TEACHING_NOTE };
export type FlowResult = {
  id: string; flow: Flow; startedAt: string; requests: RequestRecord[]; answer: string | null;
  selectedIds?: string[]; summary?: string; note?: SavedNote;
  error?: { code: string; message: string };
};
export type FlowResponse = { ok: boolean; result: FlowResult };
export type Cost = { finalInput: number | null; totalInput: number | null; totalOutput: number | null; total: number | null };
export function costOf(result: FlowResult): Cost {
  const usages = result.requests.map((request) => request.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined);
  const valid = usages.length > 0 && usages.every((usage) => typeof usage?.prompt_tokens === 'number' && typeof usage?.completion_tokens === 'number');
  const last = result.requests.at(-1);
  const finalInput = last?.step === '回答问题' && typeof usages.at(-1)?.prompt_tokens === 'number' ? usages.at(-1)!.prompt_tokens! : null;
  if (!valid) return { finalInput, totalInput: null, totalOutput: null, total: null };
  const totalInput = usages.reduce((sum, usage) => sum + usage!.prompt_tokens!, 0);
  const totalOutput = usages.reduce((sum, usage) => sum + usage!.completion_tokens!, 0);
  return { finalInput, totalInput, totalOutput, total: totalInput + totalOutput };
}
