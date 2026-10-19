import type { RequestRecord } from '../context/contract.ts';

export type QualityCondition = 'short' | 'middle' | 'first' | 'last';
export type Document = { id: string; text: string };
export type Answer = { status: 'resolved' | 'insufficient'; actual_level: number | null; mistaken_drug: string | null; source_ids: string[] };
export type QualityCase = {
  id: string; condition: QualityCondition;
  question: string; documents: Document[]; expected: Answer;
};
export type Assessment = {
  parsed: Answer | null; valid: boolean; issue?: string;
  statusCorrect: boolean; levelCorrect: boolean; drugCorrect: boolean; sourcesCorrect: boolean;
  factsComplete: boolean; allCorrect: boolean;
};
export type CaseResult = {
  caseId: string; startedAt: string; answer: string | null; expected: Answer;
  request?: RequestRecord; assessment?: Assessment; error?: { code: string; message: string };
};
export type QualityResponse = { ok: boolean; result: CaseResult };
export type Batch = { id: string; startedAt: string; results: CaseResult[]; state: 'running' | 'complete' | 'failed' };

export const QUALITY_CONDITIONS: Record<QualityCondition, string> = {
  short: '短材料 · 1条', middle: '长材料 · 关键项居中', first: '长材料 · 关键项首位',
  last: '长材料 · 关键项末位',
};
