import { ModelError } from '../model.ts';
import { isObject } from '../recorded-model.ts';
import type { OrderAnswer } from './contract.ts';

export function parseAnswer(raw: string, finishReason: string | null | undefined): OrderAnswer {
  if (finishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '回答没有完整结束，已保留原始输出。');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ModelError('MODEL_RESPONSE_INVALID', '回答不是有效JSON，已保留原文，没有自动修复。'); }
  if (!isObject(value) || Object.keys(value).length !== 2 || !('sku' in value)
    || !(value.sku === null || typeof value.sku === 'string' && !!value.sku.trim())
    || typeof value.reason !== 'string' || !value.reason.trim()) {
    throw new ModelError('MODEL_RESPONSE_INVALID', '回答未满足sku、reason字段约定，已保留原文。');
  }
  // 只识别结构，不判断产品是否选对，也不替模型纠正编号。
  return value as OrderAnswer;
}
