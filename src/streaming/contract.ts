import type { InferUIMessageChunk, UIMessage } from 'ai';
import type { ErrorCode } from '../contract.ts';

export type State = 'running' | 'completed' | 'stopped' | 'failed';
export type Stage = 'summary' | 'questions';
export type StageRecord = {
  id: string; stage: Stage; offsetMs: number; startedAt: string;
  requestBody: string; httpStatus: number | null; responseModel: string | null;
  // SDK透传的供应商JSON片段，不冒充包含SSE边界和[DONE]的原始字节流。
  providerChunks: { elapsedMs: number; value: unknown }[];
  answer: string; firstContentMs: number | null; streamEndMs: number | null;
  finishReason: string | null; sdkFinishReason: string | null; usage: unknown;
  error?: { code: ErrorCode; message: string };
};
export type Metadata = {
  model: string; state: State;
  stages: { stage: Stage; model: string | null; finishReason: string | null; usage: unknown }[];
};
export type AssistantMessage = UIMessage<Metadata, { progress: { stage: Stage | State; label: string } }>;
export type Chunk = InferUIMessageChunk<AssistantMessage>;
export type RunRecord = {
  id: string; material: string; startedAt: string; state: State; durationMs: number | null;
  stages: StageRecord[]; uiEvents: { elapsedMs: number; event: Chunk }[];
  finalMessage: AssistantMessage | null; error?: string;
};
