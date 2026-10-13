import type { RequestRecord } from '../context/contract.ts';

export type QualityCondition = 'short' | 'middle' | 'first' | 'last' | 'similar' | 'conflict';
export type Document = { id: string; text: string };
export type Answer = { status: 'resolved' | 'conflict' | 'insufficient'; actual_count: number | null; registered_count: number | null; source_ids: string[] };
export type QualityCase = {
  id: string; sample: 'A' | 'B'; condition: QualityCondition; location: string; herb: string;
  question: string; documents: Document[]; expected: Answer;
};
export type Assessment = {
  parsed: Answer | null; valid: boolean; issue?: string;
  statusCorrect: boolean; actualCorrect: boolean; registeredCorrect: boolean; sourcesCorrect: boolean;
  factsComplete: boolean; allCorrect: boolean;
};
export type CaseResult = {
  caseId: string; startedAt: string; answer: string | null; expected: Answer;
  request?: RequestRecord; assessment?: Assessment; error?: { code: string; message: string };
};
export type QualityResponse = { ok: boolean; result: CaseResult };
export type Batch = { id: string; startedAt: string; results: CaseResult[]; state: 'running' | 'complete' | 'failed' };

export const QUALITY_CONDITIONS: Record<QualityCondition, string> = {
  short: '短材料 · 16条', middle: '长材料 · 关键项居中', first: '长材料 · 关键项首位',
  last: '长材料 · 关键项末位', similar: '长材料 · 相似干扰', conflict: '长材料 · 真实冲突',
};
