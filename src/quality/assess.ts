import type { Answer, Assessment } from './contract.ts';

export function assessAnswer(raw: string, finishReason: string | null | undefined, expected: Answer): Assessment {
  const failed = (issue: string): Assessment => ({ parsed: null, valid: false, issue, statusCorrect: false, ownerCorrect: false, dateCorrect: false, sourcesCorrect: false, factsComplete: false, allCorrect: false });
  if (finishReason !== 'stop') return failed(`输出未完整结束：${finishReason ?? '未返回结束标记'}`);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return failed('返回文字不是有效 JSON 对象。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failed('返回值不是 JSON 对象。');
  const item = value as Record<string, unknown>;
  const keys = ['status', 'owner', 'freeze_date', 'source_ids'];
  if (Object.keys(item).length !== keys.length || !keys.every((key) => Object.hasOwn(item, key))
      || !['resolved', 'conflict', 'insufficient'].includes(item.status as string)
      || !(item.owner === null || typeof item.owner === 'string')
      || !(item.freeze_date === null || typeof item.freeze_date === 'string')
      || !Array.isArray(item.source_ids) || !item.source_ids.every((id) => typeof id === 'string')) {
    return failed('字段缺失、多余或类型不符；需要 status、owner、freeze_date、source_ids。');
  }
  const parsed = item as Answer;
  const statusCorrect = parsed.status === expected.status;
  const ownerCorrect = parsed.owner === expected.owner;
  const dateCorrect = parsed.freeze_date === expected.freeze_date;
  // 引用集合必须完整且没有额外或重复记录，顺序不影响判定。
  const sourcesCorrect = parsed.source_ids.length === expected.source_ids.length
    && new Set(parsed.source_ids).size === parsed.source_ids.length
    && expected.source_ids.every((id) => parsed.source_ids.includes(id));
  const factsComplete = statusCorrect && ownerCorrect && dateCorrect;
  return { parsed, valid: true, statusCorrect, ownerCorrect, dateCorrect, sourcesCorrect, factsComplete, allCorrect: factsComplete && sourcesCorrect };
}
