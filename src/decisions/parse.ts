import { ModelError } from '../model.ts';
import { isObject } from '../recorded-model.ts';
import type { Options } from './contract.ts';
import { DIRECTIONS } from './scenario.ts';

export function parseOptions(raw: string, finishReason: string | null | undefined): Options {
  if (finishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '回答没有完整结束；原始输出保留，未生成可选方案。');
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new ModelError('MODEL_RESPONSE_INVALID', '返回文字不是有效JSON；原始输出保留，请在记录中查看。'); }
  const keys = ['阅读方案', '理由', '取舍', '待问'];
  if (!isObject(payload)
    || !['方案A', '方案B'].every((name) => {
      const item = payload[name];
      return isObject(item)
        && keys.every((key) => typeof item[key] === 'string' && !!item[key].trim());
    })) {
    throw new ModelError('MODEL_RESPONSE_INVALID', 'JSON未满足两份方案的字段约定；原始输出保留，不自动补写或修复。');
  }
  // 只核对结构；原始字段保留在请求记录，页面继续使用独立编辑稿。
  return ['方案A', '方案B'].map((name, index) => {
    const item = payload[name] as Record<string, string>;
    return { direction: DIRECTIONS[index], title: DIRECTIONS[index], text: item.阅读方案, reason: item.理由, tradeoff: item.取舍, unknowns: item.待问 };
  }) as Options;
}
