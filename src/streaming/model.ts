import { APICallError, streamText } from 'ai';
import { createBailian } from '../ai-provider.ts';
import { ModelError, type ModelConfig } from '../model.ts';
import type { StageRecord } from './contract.ts';

export async function streamStage(
  config: ModelConfig, record: StageRecord, material: string, summary: string,
  signal: AbortSignal, onContent: (text: string) => void,
) {
  let started = performance.now();
  const elapsed = () => Math.round((performance.now() - started) * 10) / 10;
  const provider = createBailian(config,
    // 只被动记录SDK实际发送的正文和HTTP状态，不保存地址、密钥或请求头。
    async (url, init) => {
      started = performance.now(); record.startedAt = new Date().toISOString();
      record.requestBody = init?.body as string;
      const response = await fetch(url, init);
      record.httpStatus = response.status;
      return response;
    },
  );
  const isSummary = record.stage === 'summary';
  const result = streamText({
    model: provider.chatModel(config.model),
    instructions: isSummary
      ? '只依据工作纪要写一段约120字的简明摘要，区分已确定安排和未决事项。不补造事实，不提出问题，不加标题。'
      : '只依据工作纪要及摘要，提出2至3个需要负责人进一步确认的问题。只写编号问题，每个问题单独一行，以1.、2.、3.依次开始；不加标题、开场或答案，不把已经确定的安排当作未决事项。',
    prompt: isSummary ? material : `工作纪要：\n${material}\n\n刚生成的摘要：\n${summary}`,
    temperature: 0, maxOutputTokens: isSummary ? 256 : 384,
    providerOptions: { bailian: { enable_thinking: false } },
    abortSignal: signal, maxRetries: 0, includeRawChunks: true,
    // 错误由下面的消费路径处理，避免SDK默认日志打印供应商错误中的账户信息。
    onError: () => {},
  });
  let finished = false;
  try {
    for await (const part of result.fullStream) {
      if (part.type === 'raw') {
        const value = part.rawValue;
        // 仅保留正常供应商片段；解析失败和供应商错误原文不进入公开记录。
        if (value && typeof value === 'object' && 'choices' in value && Array.isArray(value.choices) && !('error' in value)) {
          record.providerChunks.push({ elapsedMs: elapsed(), value: structuredClone(value) });
          if ('model' in value && typeof value.model === 'string') record.responseModel = value.model;
          if ('usage' in value && value.usage != null) record.usage = structuredClone(value.usage);
          for (const choice of value.choices) {
            if (choice?.index === 0 && typeof choice.finish_reason === 'string') record.finishReason = choice.finish_reason;
          }
        }
      } else if (part.type === 'text-delta' && part.text.length > 0) {
        record.firstContentMs ??= elapsed(); record.answer += part.text; onContent(part.text);
      } else if (part.type === 'finish-step') {
        record.finishReason = part.rawFinishReason ?? record.finishReason;
        record.sdkFinishReason = part.finishReason;
        // 原始用量没提供就保留null，不拿SDK归一化的默认零值冒充供应商报告。
        record.usage = part.usage.raw ?? record.usage;
      } else if (part.type === 'finish') {
        finished = true;
      } else if (part.type === 'error') {
        throw part.error;
      } else if (part.type === 'abort') {
        signal.throwIfAborted();
        throw new ModelError('REQUEST_CANCELLED', '本次模型生成已中止。', 499);
      }
    }
    signal.throwIfAborted();
    if (!finished || record.sdkFinishReason !== 'stop' || !record.answer.length) {
      throw new ModelError('MODEL_RESPONSE_INCOMPLETE', record.sdkFinishReason === 'length'
        ? '达到输出上限，回答已截断；实际片段和用量仍保留。'
        : '模型没有完整结束回答；实际片段保留，本次不标为完成。');
    }
  } catch (error) {
    const failure = signal.aborted
      ? signal.reason?.name === 'TimeoutError'
        ? new ModelError('MODEL_TIMEOUT', '等待超过90秒，已停止；已有片段仍保留。', 504)
        : new ModelError('REQUEST_CANCELLED', '本次请求已取消。', 499)
      : error instanceof ModelError ? error
      : APICallError.isInstance(error) && error.statusCode
        ? new ModelError('MODEL_HTTP_ERROR', `模型服务返回HTTP ${error.statusCode}，本次停止；请核对权限、额度与服务状态。`, 502, error.statusCode)
        : new ModelError('MODEL_RESPONSE_INVALID', '模型连接或响应流异常；已有片段保留，没有自动重试。');
    record.error = { code: failure.code, message: failure.message };
    throw failure;
  } finally { record.streamEndMs = elapsed(); }
}
