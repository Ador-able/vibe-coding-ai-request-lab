import type { RequestRecord } from '../context/contract.ts';
import type { Extraction } from './schema.ts';

export type Mode = 'prompt' | 'object' | 'strict';
export const MODES: Record<Mode, string> = { prompt: '仅提示词要求JSON', object: 'JSON Object', strict: 'JSON Schema · strict' };
export type Check = { label: string; status: 'pass' | 'fail' | 'skip'; detail: string };
export type Inspection = {
  checks: Check[];
  data: Extraction | null;
  evidence: { index: number; found: boolean; start: number | null }[] | null;
};
export type StructuredRun = {
  id: string;
  mode: Mode;
  material: string;
  request: RequestRecord | null;
  rawAnswer: string | null;
  inspection: Inspection | null;
  error?: { code: string; message: string };
};
export type StructuredResponse = { ok: boolean; run: StructuredRun };
