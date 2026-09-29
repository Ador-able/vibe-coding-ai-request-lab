import { ModelError, type ModelConfig } from './model.ts';
import type { RequestRecord } from './context/contract.ts';
import { APICallError, generateText } from 'ai';
import { createBailian, modelOptions, type RequestInput } from './ai-provider.ts';

export function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// 调用方提供材料；取证钩子覆盖为SDK真正发出的字符串，检查器不另拼请求。
export async function sendRecordedRequest(config: ModelConfig, record: RequestRecord, signal: AbortSignal): Promise<unknown> {
  const start = performance.now();
  try {
    const input = JSON.parse(record.requestBody) as RequestInput;
    const provider = createBailian(config, async (url, init) => {
      record.requestBody = init?.body as string;
      const response = await fetch(url, init);
      record.httpStatus = response.status;
      // 在SDK检查之前保存正常HTTP响应中的原文，保留拒绝、截断和格式不合格的证据。
      if (response.ok) {
        const data: unknown = await response.clone().json().catch(() => null);
        if (isObject(data) && Array.isArray(data.choices) && isObject(data.choices[0])) {
          const choice = data.choices[0];
          record.responseModel = typeof data.model === 'string' ? data.model : undefined;
          record.usage = data.usage ?? null;
          record.finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
          record.responseMessage = choice.message;
        }
      }
      return response;
    });
    const options = modelOptions(input);
    await generateText({ ...options, model: provider.chatModel(config.model), abortSignal: signal,
      providerOptions: { bailian: { ...options.providerOptions.bailian, stream: false } },
      include: { requestBody: true, responseBody: true },
    });
    return record.responseMessage;
  } catch (error) {
    const failure = error instanceof ModelError ? error : signal.aborted
      ? signal.reason?.name === 'TimeoutError'
        ? new ModelError('MODEL_TIMEOUT', '本轮等待超过 90 秒，已停止请求。', 504)
        : new ModelError('REQUEST_CANCELLED', '本次请求已取消。', 499)
      : APICallError.isInstance(error) && error.statusCode !== undefined && (error.statusCode < 200 || error.statusCode >= 300)
        ? new ModelError('MODEL_HTTP_ERROR', `模型服务返回 HTTP ${error.statusCode}，请检查权限、额度与服务状态。`, 502, error.statusCode)
        : record.httpStatus === undefined
          ? new ModelError('MODEL_NETWORK_ERROR', '无法连接模型服务，请检查网络和模型 API 配置。')
          : new ModelError('MODEL_RESPONSE_INVALID', '模型服务返回了无法处理的结果，已收到的原始消息保留。', 502, record.httpStatus);
    record.error = failure.message;
    throw failure;
  } finally { record.durationMs = Math.round(performance.now() - start); }
}
