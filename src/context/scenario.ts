import { FOLLOW_UP, type Condition, type Message, type ToolCall } from './contract.ts';

export const SYSTEM_RULE = '你是版本记录查询助手。只根据本次请求中的消息和工具结果回答；不要猜测版本信息。证据不足时，明确说明缺少什么信息。仅回答当前问题要求的字段，用简洁的中文表述。';

// 本地虚构资料；只有工具执行后，记录内容才会进入模型请求。
export const RELEASE = {
  release_id: 'release-2026-09-28',
  published_at: '2026年9月28日 14:30（北京时间）',
  owner: '林晓禾',
  notes: '优化导出页面的提示信息。',
};

export const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_release_info',
    description: '查询指定版本的发布记录。',
    parameters: {
      type: 'object',
      properties: { release_id: { type: 'string', description: '需要查询的版本编号。' } },
      required: ['release_id'],
      additionalProperties: false,
    },
  },
}];

export class LabError extends Error {
  constructor(public code: string, message: string, public httpStatus = 502) {
    super(message);
  }
}

export function executeReleaseTool(call: ToolCall): Message & { role: 'tool' } {
  let args: unknown;
  try { args = JSON.parse(call.function.arguments); } catch {
    throw new LabError('TOOL_ARGUMENTS_INVALID', '模型返回的工具参数不是有效 JSON，首轮尚未建立。');
  }
  if (call.function.name !== 'get_release_info' || !args || typeof args !== 'object'
      || Array.isArray(args) || Object.keys(args).length !== 1
      || !('release_id' in args) || args.release_id !== RELEASE.release_id) {
    throw new LabError('TOOL_ARGUMENTS_INVALID', '模型没有提供本实验所需的工具名与版本编号，首轮尚未建立。');
  }
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(RELEASE) };
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
