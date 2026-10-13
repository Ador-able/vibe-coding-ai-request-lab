import type { RequestRecord } from '../context/contract.ts';

export type SavedRule = { text: string; enabled: boolean; confirmedAt: string; updatedAt: string };
export type RuleMode = 'none' | 'saved';
export type ReferenceRecord = { id: string; speaker: string; text: string };
export type ReferenceAnswer = { 人物: string | null; 依据: string };
export type FeedbackRun = {
  id: string;
  record: ReferenceRecord;
  ruleMode: RuleMode;
  ruleSnapshot: SavedRule | null;
  request: RequestRecord | null;
  rawAnswer: string | null;
  answer: ReferenceAnswer | null;
  error?: { code: string; message: string };
};
export type FeedbackResponse = { ok: boolean; run: FeedbackRun };
export type RuleResponse = { rule: SavedRule | null; error?: string };
