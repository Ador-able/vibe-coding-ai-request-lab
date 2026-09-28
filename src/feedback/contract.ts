import type { RequestRecord } from '../context/contract.ts';

export type SavedRule = { text: string; enabled: boolean; confirmedAt: string; updatedAt: string };
export type RuleMode = 'none' | 'saved';
export type Order = { id: string; customer: string; text: string };
export type OrderAnswer = { sku: string | null; reason: string };
export type FeedbackRun = {
  id: string;
  order: Order;
  ruleMode: RuleMode;
  ruleSnapshot: SavedRule | null;
  request: RequestRecord | null;
  rawAnswer: string | null;
  answer: OrderAnswer | null;
  error?: { code: string; message: string };
};
export type FeedbackResponse = { ok: boolean; run: FeedbackRun };
export type RuleResponse = { rule: SavedRule | null; error?: string };
