import { FOLLOW_UP, type Condition, type Message, type ToolCall } from './contract.ts';

export const SYSTEM_RULE = '你是小说资料查询助手。只根据本次请求中的消息和工具结果回答；不要猜测小说设定。证据不足时，明确说明缺少什么信息。仅回答当前问题要求的字段，用简洁的中文表述。';

// 工具执行后，小说原文才会进入模型请求。
import { SOURCES } from '../novel-materials.ts';

export const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_novel_excerpt',
    description: '读取《凡人修仙传》第一条原文。',
    parameters: {
      type: 'object',
      properties: { source_id: { type: 'string', enum: ['C01'], description: '资料编号，只填C01。' } },
      required: ['source_id'],
      additionalProperties: false,
    },
  },
}];

export class LabError extends Error {
  constructor(public code: string, message: string, public httpStatus = 502) {
    super(message);
  }
}

export function executeNovelTool(call: ToolCall): Message & { role: 'tool' } {
  let args: unknown;
  try { args = JSON.parse(call.function.arguments); } catch {
    throw new LabError('TOOL_ARGUMENTS_INVALID', '模型返回的工具参数不是有效 JSON，首轮尚未建立。');
  }
  if (call.function.name !== 'get_novel_excerpt' || !args || typeof args !== 'object'
      || Array.isArray(args) || Object.keys(args).length !== 1
      || !('source_id' in args) || args.source_id !== 'C01') {
    throw new LabError('TOOL_ARGUMENTS_INVALID', '模型没有提供本实验所需的工具名与资料编号，首轮尚未建立。');
  }
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ source_id: SOURCES[0].id, title: SOURCES[0].title, text: SOURCES[0].text }) };
}

export function projectHistory(history: Message[], condition: Condition): Message[] {
  // 三种条件共享同一系统规则，差别仅在历史；追问不写回首轮历史。
  const system = history.filter((message) => message.role === 'system');
  let kept: Message[] = [];
  if (condition === 'full') kept = history.filter((message) => message.role !== 'system');
  if (condition === 'chat') {
    kept = history.flatMap((message): Message[] => {
      if (message.role === 'user') return [message];
      if (message.role === 'assistant' && message.content) return [{ role: 'assistant', content: message.content }];
      return [];
    });
  }
  return [...system, ...kept, { role: 'user', content: FOLLOW_UP }];
}
