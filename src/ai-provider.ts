import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { jsonSchema, tool, type JSONSchema7, type JSONValue, type ModelMessage, type ToolChoice, type ToolSet } from 'ai';
import type { ModelConfig } from './model.ts';
import type { Message } from './context/contract.ts';

// 课程内部已有的请求材料；真正发出的正文由provider取证钩子保存。
export type RequestInput = {
  model: string; messages: Message[]; max_tokens: number; temperature?: number;
  enable_thinking?: boolean; response_format?: Record<string, JSONValue>; parallel_tool_calls?: boolean;
  tools?: { type: 'function'; function: { name: string; description: string; parameters: JSONSchema7 } }[];
  tool_choice?: 'none' | { type: 'function'; function: { name: string } };
};

export function createBailian(config: ModelConfig, observedFetch?: typeof fetch) {
  return createOpenAICompatible({ name: 'bailian', baseURL: config.baseUrl, apiKey: config.apiKey, includeUsage: true, fetch: observedFetch });
}

export function modelOptions(input: RequestInput) {
  const calls = new Map(input.messages.flatMap((message) => message.role === 'assistant'
    ? (message.tool_calls ?? []).map((call) => [call.id, call.function.name] as const) : []));
  const messages: ModelMessage[] = input.messages.filter((message) => message.role !== 'system').map((message): ModelMessage => {
    if (message.role === 'assistant') {
      return { role: 'assistant', content: [
        ...(message.content ? [{ type: 'text' as const, text: message.content }] : []),
        ...(message.tool_calls ?? []).map((call) => ({ type: 'tool-call' as const, toolCallId: call.id, toolName: call.function.name, input: JSON.parse(call.function.arguments) })),
      ] };
    }
    if (message.role === 'tool') {
      return { role: 'tool', content: [{ type: 'tool-result', toolCallId: message.tool_call_id,
        toolName: calls.get(message.tool_call_id)!, output: { type: 'text', value: message.content } }] };
    }
    return { role: 'user', content: message.content };
  });
  const tools: ToolSet | undefined = input.tools && Object.fromEntries(input.tools.map(({ function: fn }) => [fn.name,
    tool({ description: fn.description, inputSchema: jsonSchema(fn.parameters) }),
  ]));
  const toolChoice: ToolChoice<ToolSet> | undefined = input.tool_choice === 'none' ? 'none'
    : input.tool_choice ? { type: 'tool', toolName: input.tool_choice.function.name } : undefined;
  const extra: Record<string, JSONValue> = { enable_thinking: input.enable_thinking ?? false };
  if (input.response_format) extra.response_format = input.response_format;
  if (input.parallel_tool_calls !== undefined) extra.parallel_tool_calls = input.parallel_tool_calls;
  return {
    instructions: input.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n'),
    messages, tools, toolChoice, maxOutputTokens: input.max_tokens, temperature: input.temperature,
    providerOptions: { bailian: extra }, maxRetries: 0,
  };
}
