import type { InferUIMessageChunk, UIMessage } from 'ai';
import type { StreamRecord } from '../latency/contract.ts';

export type State = 'running' | 'completed' | 'stopped' | 'failed';
export type Stage = 'summary' | 'questions';
export type StageRecord = Omit<StreamRecord, 'condition'> & { stage: Stage; offsetMs: number };
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
