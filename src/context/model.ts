import { ModelError, type ModelConfig } from '../model.ts';
import type { Message, RequestRecord, ToolCall } from './contract.ts';
import { TOOLS } from './scenario.ts';

type ToolChoice = 'none' | { type: 'function'; function: { name: 'get_release_info' } };
type AssistantMessage = Message & { role: 'assistant' };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseMessage(value: unknown): AssistantMessage {
  if (!object(value) || value.role !== 'assistant' || (value.content !== null && typeof value.content !== 'string')) {
    throw new ModelError('MODEL_RESPONSE_INVALID', '模型没有返回可识别的助手消息。');
  }
  const message: AssistantMessage = { role: 'assistant', content: value.content };
  if (value.tool_calls !== null && value.tool_calls !== undefined) {
    if (!Array.isArray(value.tool_calls)) throw new ModelError('MODEL_RESPONSE_INVALID', '模型返回的工具调用格式不完整。');
    message.tool_calls = value.tool_calls.map((call): ToolCall => {
      if (!object(call) || typeof call.id !== 'string' || !call.id || call.type !== 'function'
          || !object(call.function) || typeof call.function.name !== 'string' || typeof call.function.arguments !== 'string') {
        throw new ModelError('MODEL_RESPONSE_INVALID', '模型返回的工具调用缺少名称、参数或编号。');
      }
      return { id: call.id, type: 'function', function: { name: call.function.name, arguments: call.function.arguments } };
    });
  }
  return message;
}

export async function callContextModel(
  config: ModelConfig, messages: Message[], toolChoice: ToolChoice,
  records: RequestRecord[], step: string, signal: AbortSignal,
): Promise<AssistantMessage> {
  // 这一个字符串既是 fetch 的 body，也是检查器保存的原始请求；不另拼展示对象。
  const requestBody = JSON.stringify({
    model: config.model, messages, tools: TOOLS, tool_choice: toolChoice,
    stream: false, enable_thinking: false, parallel_tool_calls: false, max_tokens: 512, temperature: 0,
  });
  const record: RequestRecord = { step, startedAt: new Date().toISOString(), requestBody };
  records.push(record);
  const start = performance.now();
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: requestBody, signal,
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
    if (!object(data) || !Array.isArray(data.choices) || !object(data.choices[0])) {
      throw new ModelError('MODEL_RESPONSE_INVALID', '模型服务没有返回可识别的结果。');
    }
    const choice = data.choices[0];
    record.responseModel = typeof data.model === 'string' ? data.model : undefined;
    record.usage = data.usage ?? null;
    record.finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
    record.responseMessage = choice.message;
    const message = parseMessage(choice.message);
    if (toolChoice === 'none') {
      if (message.tool_calls?.length) throw new ModelError('MODEL_RESPONSE_INVALID', '模型在禁止工具调用时仍返回了调用指令；程序没有执行它。');
      if (record.finishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '模型没有完整结束回答，原始返回已保留在记录中。');
      if (!message.content?.trim()) throw new ModelError('MODEL_RESPONSE_INVALID', '模型没有返回回答文字。');
    } else if (record.finishReason !== 'tool_calls' || message.tool_calls?.length !== 1) {
      throw new ModelError('MODEL_RESPONSE_INVALID', '模型没有返回本实验要求的一次工具调用，首轮尚未建立。');
    }
    return message;
  } catch (error) {
    let failure: ModelError;
    if (error instanceof ModelError) failure = error;
    else if (signal.aborted) {
      failure = signal.reason?.name === 'TimeoutError'
        ? new ModelError('MODEL_TIMEOUT', '本轮等待超过 90 秒，已停止请求。', 504)
        : new ModelError('REQUEST_CANCELLED', '本次请求已取消。', 499);
    } else failure = new ModelError('MODEL_NETWORK_ERROR', '无法连接模型服务，请检查网络和模型 API 配置。');
    record.error = failure.message;
    throw failure;
  } finally { record.durationMs = Math.round(performance.now() - start); }
}
