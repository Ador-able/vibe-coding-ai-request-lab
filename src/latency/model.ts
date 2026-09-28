import { ModelError, type ModelConfig } from '../model.ts';
import { isObject } from '../recorded-model.ts';
import { readEvents } from './sse.ts';
import type { StreamRecord } from './contract.ts';

export async function streamModel(
  config: ModelConfig,
  record: StreamRecord,
  signal: AbortSignal,
  onContent: (text: string, elapsedMs: number) => void,
) {
  // 计时只涵盖本机后端发起 fetch 到收到数据，不代表 GPU 内部阶段。
  const start = performance.now();
  const elapsed = () => Math.round((performance.now() - start) * 10) / 10;
  record.startedAt = new Date().toISOString();
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: record.requestBody,
      signal,
    });
    record.httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new ModelError('MODEL_HTTP_ERROR', `模型服务返回 HTTP ${response.status}，本次停止；请核对 API 权限、额度与服务状态。`, 502, response.status);
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      await response.body?.cancel();
      throw new ModelError('MODEL_RESPONSE_INVALID', '模型服务没有返回 SSE 事件流。');
    }
    for await (const event of readEvents(response.body)) {
      const elapsedMs = elapsed();
      if (event.data === '[DONE]') {
        record.events.push({ ...event, elapsedMs });
        record.endedBy = 'done'; record.streamEndMs = elapsedMs;
        break;
      }
      let payload: unknown;
      try { payload = JSON.parse(event.data); } catch { throw new ModelError('MODEL_RESPONSE_INVALID', '流中有无法读取的 JSON 事件。'); }
      // 只公开正常响应事件；服务商错误原文可能带账户信息，不回传它。
      if (!isObject(payload) || Object.hasOwn(payload, 'error') || !Array.isArray(payload.choices)) {
        throw new ModelError('MODEL_RESPONSE_INVALID', '模型流返回了错误或无法识别的事件，已保留此前记录。');
      }
      record.events.push({ ...event, elapsedMs });
      if (typeof payload.model === 'string') record.responseModel = payload.model;
      if (payload.usage !== undefined && payload.usage !== null) record.usage = payload.usage;
      // include_usage 的末尾块可以只有用量，choices 为空。
      for (const choice of payload.choices) {
        if (!isObject(choice) || choice.index !== 0 || !isObject(choice.delta)) {
          throw new ModelError('MODEL_RESPONSE_INVALID', '模型流的候选结构不正确。');
        }
        if (typeof choice.finish_reason === 'string') record.finishReason = choice.finish_reason;
        const content = choice.delta.content;
        if (typeof content === 'string' && content.length > 0) {
          record.firstContentMs ??= elapsedMs;
          record.answer += content;
          onContent(content, elapsedMs);
        }
      }
    }
    if (record.endedBy === null) { record.endedBy = 'eof'; record.streamEndMs = elapsed(); }
    if (record.finishReason !== 'stop' || !record.answer.length) {
      throw new ModelError('MODEL_RESPONSE_INCOMPLETE', record.finishReason === 'length'
        ? '达到输出上限，回答已截断；实际片段和用量仍保留。'
        : '流没有完整结束回答；实际片段仍保留，本次不标为完成。');
    }
  } catch (error) {
    const failure = error instanceof ModelError ? error : signal.aborted
      ? signal.reason?.name === 'TimeoutError'
        ? new ModelError('MODEL_TIMEOUT', '等待超过 90 秒，已停止；已有片段仍保留。', 504)
        : new ModelError('REQUEST_CANCELLED', '本次请求已取消。', 499)
      : new ModelError('MODEL_NETWORK_ERROR', '读取模型流失败；已有片段仍保留，没有自动重试。');
    record.error = { code: failure.code, message: failure.message };
    throw failure;
  }
}
