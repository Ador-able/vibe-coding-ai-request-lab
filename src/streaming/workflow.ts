import { createUIMessageStream } from 'ai';
import { ModelError, readConfig } from '../model.ts';
import { streamModel } from '../latency/model.ts';
import type { AssistantMessage, Chunk, Metadata, RunRecord, Stage, StageRecord } from './contract.ts';

export function buildStageBody(model: string, material: string, stage: Stage, summary = '') {
  const system = stage === 'summary'
    ? '只依据工作纪要写一段约120字的简明摘要，区分已确定安排和未决事项。不补造事实，不提出问题，不加标题。'
    : '只依据工作纪要及摘要，提出2至3个需要负责人进一步确认的问题。只写编号问题，每个问题单独一行，以1.、2.、3.依次开始；不加标题、开场或答案，不把已经确定的安排当作未决事项。';
  return JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: stage === 'summary' ? material : `工作纪要：\n${material}\n\n刚生成的摘要：\n${summary}` }],
    stream: true, stream_options: { include_usage: true }, enable_thinking: false, temperature: 0, max_tokens: stage === 'summary' ? 256 : 384 });
}

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
      const write = (event: Chunk) => { record.uiEvents.push({ elapsedMs: elapsed(), event }); writer.write(event); };
      const progress = (stage: Stage | RunRecord['state'], label: string) => write({ type: 'data-progress', id: 'workflow-progress', data: { stage, label } });
      write({ type: 'start', messageId: record.id, messageMetadata: metadata() });
      try {
        const config = readConfig(env);
        let summary = '';
        for (const stage of ['summary', 'questions'] as const) {
          signal.throwIfAborted();
          progress(stage, stage === 'summary' ? '应用正在生成摘要' : '摘要已结束，应用正在生成待确认问题');
          const item: StageRecord = { id: `${record.id}-${stage}`, stage, offsetMs: elapsed(), startedAt: '', requestBody: buildStageBody(config.model, record.material, stage, summary),
            responseModel: null, httpStatus: null, events: [], answer: '', firstContentMs: null, streamEndMs: null, endedBy: null, finishReason: null, usage: null };
          record.stages.push(item);
          write({ type: 'start-step' }); write({ type: 'text-start', id: stage });
          await streamModel(config, item, signal, (delta) => write({ type: 'text-delta', id: stage, delta }));
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
    onEnd: ({ responseMessage }) => { record.finalMessage = responseMessage; },
  });
}
