import { FOLLOW_UP, type Condition, type Message, type ToolCall } from './contract.ts';

export const SYSTEM_RULE = '你是小说资料查询助手。只根据本次请求中的消息和工具结果回答；不要猜测小说设定。证据不足时，明确说明缺少什么信息。仅回答当前问题要求的字段，用简洁的中文表述。';

// 工具执行后，清点记录才会进入模型请求。
export { INVENTORY } from '../novel-materials.ts';
import { INVENTORY } from '../novel-materials.ts';

export const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_herb_record',
    description: '查询《青岚修仙录》中炼丹房的凝露草收药与清点记录。',
    parameters: {
      type: 'object',
      properties: { room: { type: 'string', enum: ['炼丹房'], description: '房间名称，只填炼丹房。' } },
      required: ['room'],
      additionalProperties: false,
    },
  },
}];

export class LabError extends Error {
  constructor(public code: string, message: string, public httpStatus = 502) {
    super(message);
  }
}

export function executeHerbTool(call: ToolCall): Message & { role: 'tool' } {
  let args: unknown;
  try { args = JSON.parse(call.function.arguments); } catch {
    throw new LabError('TOOL_ARGUMENTS_INVALID', '模型返回的工具参数不是有效 JSON，首轮尚未建立。');
  }
  if (call.function.name !== 'get_herb_record' || !args || typeof args !== 'object'
      || Array.isArray(args) || Object.keys(args).length !== 1
      || !('room' in args) || args.room !== INVENTORY.room) {
    throw new LabError('TOOL_ARGUMENTS_INVALID', '模型没有提供本实验所需的工具名与房间名称，首轮尚未建立。');
  }
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(INVENTORY) };
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
