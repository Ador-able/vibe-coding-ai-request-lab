import { ModelError, type ModelConfig } from '../model.ts';
import type { Message, RequestRecord, ToolCall } from './contract.ts';
import { TOOLS } from './scenario.ts';
import { isObject as object, sendRecordedRequest } from '../recorded-model.ts';

type ToolChoice = 'none' | { type: 'function'; function: { name: 'get_release_info' } };
type AssistantMessage = Message & { role: 'assistant' };

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
  try {
    const message = parseMessage(await sendRecordedRequest(config, record, signal));
    if (toolChoice === 'none') {
      if (message.tool_calls?.length) throw new ModelError('MODEL_RESPONSE_INVALID', '模型在禁止工具调用时仍返回了调用指令；程序没有执行它。');
      if (record.finishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '模型没有完整结束回答，原始返回已保留在记录中。');
      if (!message.content?.trim()) throw new ModelError('MODEL_RESPONSE_INVALID', '模型没有返回回答文字。');
    } else if (!['stop', 'tool_calls'].includes(record.finishReason ?? '') || message.tool_calls?.length !== 1) {
      throw new ModelError('MODEL_RESPONSE_INVALID', '模型没有返回本实验要求的一次工具调用，首轮尚未建立。');
    }
    return message;
  } catch (error) {
    if (error instanceof ModelError) record.error = error.message;
    throw error;
  }
}
