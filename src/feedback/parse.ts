import { ModelError } from '../model.ts';
import { isObject } from '../recorded-model.ts';
import type { ReferenceAnswer } from './contract.ts';

export function parseAnswer(raw: string, finishReason: string | null | undefined): ReferenceAnswer {
  if (finishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '回答没有完整结束，已保留原始输出。');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ModelError('MODEL_RESPONSE_INVALID', '回答不是有效JSON，已保留原文，没有自动修复。'); }
  if (!isObject(value) || Object.keys(value).length !== 2 || !('人物' in value)
    || !(value.人物 === null || typeof value.人物 === 'string' && !!value.人物.trim())
    || typeof value.依据 !== 'string' || !value.依据.trim()) {
    throw new ModelError('MODEL_RESPONSE_INVALID', '回答未满足“人物”“依据”字段约定，已保留原文。');
  }
  // 只识别结构，人物判断仍由读者对照笔记和规则核对。
  return value as ReferenceAnswer;
}
