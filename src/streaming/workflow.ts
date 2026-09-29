import { createUIMessageStream } from 'ai';
import { ModelError, readConfig } from '../model.ts';
import { streamStage } from './model.ts';
import type { AssistantMessage, Chunk, Metadata, RunRecord, Stage, StageRecord } from './contract.ts';

// 只在正文完整结束后检查行数，不把正在到达的半句当成最终问题。
export function checkQuestions(text: string) {
  const lines = text.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2 || lines.length > 3 || !lines.every((line, i) => new RegExp(`^${i + 1}[.、．)]\\s*\\S`).test(line))) {
    throw new ModelError('MODEL_RESPONSE_INVALID', '问题阶段已返回，但不符合2至3条编号问题的约定；原文保留，本次未完成。');
  }
  return lines;
}

export function createWorkflow(record: RunRecord, env: NodeJS.ProcessEnv, signal: AbortSignal) {
  const start = performance.now();
  const elapsed = () => Math.round((performance.now() - start) * 10) / 10;
  const metadata = (): Metadata => ({ model: env.MODEL?.trim() || '未配置', state: record.state,
    stages: record.stages.map((stage) => ({ stage: stage.stage, model: stage.responseModel, finishReason: stage.finishReason, usage: stage.usage })) });
  return createUIMessageStream<AssistantMessage>({
    execute: async ({ writer }) => {
      // SDK会就地更新同ID的数据片段；历史记录必须在交给SDK前拍下快照。
      const write = (event: Chunk) => { record.uiEvents.push({ elapsedMs: elapsed(), event: structuredClone(event) }); writer.write(event); };
      const progress = (stage: Stage | RunRecord['state'], label: string) => write({ type: 'data-progress', id: 'workflow-progress', data: { stage, label } });
      write({ type: 'start', messageId: record.id, messageMetadata: metadata() });
      try {
        const config = readConfig(env);
        let summary = '';
        for (const stage of ['summary', 'questions'] as const) {
          signal.throwIfAborted();
          progress(stage, stage === 'summary' ? '应用正在生成摘要' : '摘要已结束，应用正在生成待确认问题');
          const item: StageRecord = { id: `${record.id}-${stage}`, stage, offsetMs: elapsed(), startedAt: '', requestBody: '',
            responseModel: null, httpStatus: null, providerChunks: [], answer: '', firstContentMs: null, streamEndMs: null, finishReason: null, sdkFinishReason: null, usage: null };
          record.stages.push(item);
          write({ type: 'start-step' }); write({ type: 'text-start', id: stage });
          await streamStage(config, item, record.material, summary, signal, (delta) => write({ type: 'text-delta', id: stage, delta }));
          signal.throwIfAborted();
          write({ type: 'text-end', id: stage }); write({ type: 'finish-step' });
          if (stage === 'summary') summary = item.answer;
          else checkQuestions(item.answer);
        }
        record.state = 'completed';
        progress('completed', '摘要和待确认问题均已完整结束');
        write({ type: 'finish', finishReason: 'stop', messageMetadata: metadata() });
        writer.setOutcome({ status: 'completed' });
      } catch (error) {
        const cancelled = signal.aborted && signal.reason?.name !== 'TimeoutError';
        record.state = cancelled ? 'stopped' : 'failed';
        record.error = cancelled ? '已停止，收到的文字仍保留，任务未完成。'
          : error instanceof ModelError ? error.message : '处理被中断，已收到的文字保留，没有自动重试。';
        progress(record.state, record.error);
        write({ type: 'message-metadata', messageMetadata: metadata() });
        write(cancelled ? { type: 'abort', reason: record.error } : { type: 'error', errorText: record.error });
        writer.setOutcome({ status: cancelled ? 'aborted' : 'failed' });
      } finally { record.durationMs = elapsed(); }
    },
    onError: () => '消息流处理失败，已收到的文字保留。',
    onEnd: ({ responseMessage }) => { record.finalMessage = structuredClone(responseMessage); },
  });
}
