import { ModelError, type ModelConfig } from './model.ts';
import type { RequestRecord } from './context/contract.ts';

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// 调用方传入已序列化的同一个字符串；检查器和网络请求共用它。
export async function sendRecordedRequest(config: ModelConfig, record: RequestRecord, signal: AbortSignal): Promise<unknown> {
  const start = performance.now();
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: record.requestBody, signal,
    });
    record.httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      const hint = response.status === 401 || response.status === 403 ? '请检查模型 API 密钥、地域和业务空间是否匹配。'
        : response.status === 429 ? '请检查模型额度或稍后重试。' : '请稍后重试，并核对模型 API 配置。';
      throw new ModelError('MODEL_HTTP_ERROR', `模型服务返回 HTTP ${response.status}。${hint}`, 502, response.status);
    }
    let data: unknown;
    try { data = await response.json(); } catch (error) {
      if (signal.aborted) throw error;
      throw new ModelError('MODEL_RESPONSE_INVALID', '模型服务没有返回有效 JSON。');
    }
    if (!isObject(data) || !Array.isArray(data.choices) || !isObject(data.choices[0])) {
      throw new ModelError('MODEL_RESPONSE_INVALID', '模型服务没有返回可识别的结果。');
    }
    const choice = data.choices[0];
    record.responseModel = typeof data.model === 'string' ? data.model : undefined;
    record.usage = data.usage ?? null;
    record.finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
    record.responseMessage = choice.message;
    return choice.message;
  } catch (error) {
    const failure = error instanceof ModelError ? error : signal.aborted
      ? signal.reason?.name === 'TimeoutError'
        ? new ModelError('MODEL_TIMEOUT', '本轮等待超过 90 秒，已停止请求。', 504)
        : new ModelError('REQUEST_CANCELLED', '本次请求已取消。', 499)
      : new ModelError('MODEL_NETWORK_ERROR', '无法连接模型服务，请检查网络和模型 API 配置。');
    record.error = failure.message;
    throw failure;
  } finally { record.durationMs = Math.round(performance.now() - start); }
}
