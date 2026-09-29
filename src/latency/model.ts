import { APICallError, streamText } from 'ai';
import { ModelError, type ModelConfig } from '../model.ts';
import { isObject } from '../recorded-model.ts';
import { createBailian, modelOptions, type RequestInput } from '../ai-provider.ts';
import { observeEvents } from './sse.ts';
import type { StreamRecord } from './contract.ts';

export async function streamModel(
  config: ModelConfig, record: Omit<StreamRecord, 'condition'>, signal: AbortSignal,
  onContent: (text: string, elapsedMs: number) => void,
) {
  const controller = new AbortController();
  const requestSignal = AbortSignal.any([signal, controller.signal]);
  const input = JSON.parse(record.requestBody) as RequestInput;
  let start = performance.now();
  const elapsed = () => Math.round((performance.now() - start) * 10) / 10;
  const provider = createBailian(config, async (url, init) => {
    start = performance.now(); record.startedAt = new Date().toISOString(); record.requestBody = init?.body as string;
    const response = await fetch(url, init); record.httpStatus = response.status;
    if (!response.ok || !response.body) return response;
    const observed = observeEvents(response.body, (event) => {
      if (record.endedBy === 'done') return;
      const elapsedMs = elapsed();
      if (event.data === '[DONE]') {
        record.events.push({ ...event, elapsedMs }); record.endedBy = 'done'; record.streamEndMs = elapsedMs; return;
      }
      // 只保存正常响应；原始错误正文可能包含账户信息，不进入公开取证。
      let value: unknown; try { value = JSON.parse(event.data); } catch { return; }
      if (!isObject(value) || Object.hasOwn(value, 'error') || !Array.isArray(value.choices)) return;
      record.events.push({ ...event, elapsedMs });
      if (typeof value.model === 'string') record.responseModel = value.model;
      if (value.usage != null) record.usage = value.usage;
      for (const choice of value.choices) {
        if (!isObject(choice) || choice.index !== 0) continue;
        if (typeof choice.finish_reason === 'string') record.finishReason = choice.finish_reason;
        if (isObject(choice.delta) && typeof choice.delta.content === 'string' && choice.delta.content.length > 0) record.firstContentMs ??= elapsedMs;
      }
    }, () => { if (record.endedBy === null) { record.endedBy = 'eof'; record.streamEndMs = elapsed(); } });
    return new Response(observed, { status: response.status, statusText: response.statusText, headers: response.headers });
  });
  let finished = false; let sdkReason: string | null = null;
  try {
    const result = streamText({ ...modelOptions(input), model: provider.chatModel(config.model), abortSignal: requestSignal, onError: () => {} });
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta' && part.text.length > 0) {
        record.answer += part.text; onContent(part.text, elapsed());
      } else if (part.type === 'finish') { finished = true; sdkReason = part.finishReason; }
      else if (part.type === 'error') {
        if (record.endedBy !== null && record.finishReason === null && record.answer) throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '流没有完整结束回答；实际片段仍保留。');
        throw part.error;
      } else if (part.type === 'abort') { signal.throwIfAborted(); throw new ModelError('REQUEST_CANCELLED', '本次请求已取消。', 499); }
    }
    signal.throwIfAborted();
    if (!finished || sdkReason !== 'stop' || record.finishReason !== 'stop' || !record.answer.length) {
      throw new ModelError('MODEL_RESPONSE_INCOMPLETE', record.finishReason === 'length'
        ? '达到输出上限，回答已截断；实际片段和用量仍保留。'
        : '流没有完整结束回答；实际片段仍保留，本次不标为完成。');
    }
  } catch (error) {
    const failure = error instanceof ModelError ? error : signal.aborted
      ? signal.reason?.name === 'TimeoutError'
        ? new ModelError('MODEL_TIMEOUT', '等待超过90秒，已停止；已有片段仍保留。', 504)
        : new ModelError('REQUEST_CANCELLED', '本次请求已取消。', 499)
      : APICallError.isInstance(error) && error.statusCode !== undefined && (error.statusCode < 200 || error.statusCode >= 300)
        ? new ModelError('MODEL_HTTP_ERROR', `模型服务返回 HTTP ${error.statusCode}，本次停止。`, 502, error.statusCode)
        : new ModelError(record.httpStatus === null ? 'MODEL_NETWORK_ERROR' : 'MODEL_RESPONSE_INVALID', '读取模型流失败；已有片段仍保留，没有自动重试。', 502, record.httpStatus ?? undefined);
    record.error = { code: failure.code, message: failure.message }; throw failure;
  } finally {
    // 退出消费不等于取消SDK内部流；结束时释放同一次上游请求。
    controller.abort();
  }
}
