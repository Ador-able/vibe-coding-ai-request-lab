import type { ModelMessage, UIMessage } from 'ai';
import { validateUIMessages } from 'ai';
import { z } from 'zod';

export const fixtureKeySchema = z.enum(['normal', 'stopped']);
export const phaseSchema = z.enum(['snapshotEarly', 'snapshotLater', 'final']);
export const conversationIdSchema = z.uuid();
export type FixtureKey = z.infer<typeof fixtureKeySchema>;
export type ImportPhase = z.infer<typeof phaseSchema>;
export type CompletionState = 'submitted' | 'incomplete' | 'completed' | 'stopped';

const metadataSchema = z.looseObject({
  model: z.string(),
  state: z.enum(['running', 'completed', 'stopped', 'failed']),
  stages: z.array(z.looseObject({
    stage: z.enum(['summary', 'questions']),
    model: z.string().nullable(),
    finishReason: z.string().nullable(),
    usage: z.unknown(),
  })),
}).optional();
const progressSchema = z.looseObject({
  stage: z.enum(['summary', 'questions', 'running', 'completed', 'stopped', 'failed']),
  label: z.string(),
});
const reviewSchema = z.object({ targetMessageId: z.string().min(1), text: z.string().min(1) });

export type Metadata = Exclude<z.infer<typeof metadataSchema>, undefined>;
export type Message = UIMessage<Metadata, {
  progress: z.infer<typeof progressSchema>;
  'review-note': z.infer<typeof reviewSchema>;
}>;

// 校验副本，保留原数组中缺字段与 null、片段顺序及全部解析值。
export async function validateMessages(messages: unknown): Promise<Message[]> {
  await validateUIMessages<Message>({
    messages: structuredClone(messages),
    metadataSchema,
    dataSchemas: { progress: progressSchema, 'review-note': reviewSchema },
  });
  return messages as Message[];
}

export type Conversation = {
  id: string;
  sourceRecordId: string;
  createdAt: string;
};
export type StoredEntry = {
  messageId: string;
  position: number;
  completionState: CompletionState;
};
export type RawRow = {
  conversation_id: string;
  message_id: string;
  position: number;
  role: Message['role'];
  parts_json: string;
  metadata_json: string | null;
  completion_state: CompletionState;
};
export type ConversationView = {
  conversation: Conversation;
  messages: Message[];
  entries: StoredEntry[];
  rawRows: RawRow[];
};
export type FixtureSummary = {
  key: FixtureKey;
  sourceRecordId: string;
  sourceRecordState: 'completed' | 'stopped';
  userMessage: Message;
  feedbackMessage: Message;
  phases: ImportPhase[];
};
export type Catalog = {
  fixtures: FixtureSummary[];
  files: { filename: string; bytes: number; sha256: string }[];
  sdkVersion: '7.0.122';
  modelCalls: 0;
};
export type Projection = { chosenUiMessages: Message[]; modelMessages: ModelMessage[] };
export type PreparedInput = {
  conversationId: string;
  sdkVersion: '7.0.122';
  modelCalled: false;
  sourceUiMessages: Message[];
  storedEntries: StoredEntry[];
  excluded: { messageId: string; completionState: CompletionState; reason: string }[];
  projections: { P0: Projection; P1: Projection; P2: Projection };
  nextInput: { system: string; messages: ModelMessage[] };
};
