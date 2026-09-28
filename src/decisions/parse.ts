import { ModelError } from '../model.ts';
import { isObject } from '../recorded-model.ts';
import type { Options } from './contract.ts';

export function parseOptions(raw: string, finishReason: string | null | undefined): Options {
  if (finishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '回答没有完整结束；原始输出保留，未生成可选方案。');
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new ModelError('MODEL_RESPONSE_INVALID', '返回文字不是有效JSON；原始输出保留，请在记录中查看。'); }
  const keys = ['direction', 'title', 'text', 'reason', 'tradeoff', 'unknowns'];
  const directions = ['信息优先', '参与感优先'];
  if (!isObject(payload) || Object.keys(payload).length !== 1 || !Array.isArray(payload.options) || payload.options.length !== 2
    || !payload.options.every((item: unknown, index: number) => isObject(item) && Object.keys(item).length === keys.length
      && keys.every((key) => typeof item[key] === 'string' && !!item[key].trim()) && item.direction === directions[index])) {
    throw new ModelError('MODEL_RESPONSE_INVALID', 'JSON未满足两份方案的字段约定；原始输出保留，不自动补写或修复。');
  }
  // 这里只核对结构；理由、取舍及文案事实仍由人判断。
  return payload.options as Options;
}
