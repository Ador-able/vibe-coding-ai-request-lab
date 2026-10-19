import type { Answer, Assessment } from './contract.ts';

export function assessAnswer(raw: string, finishReason: string | null | undefined, expected: Answer): Assessment {
  const failed = (issue: string): Assessment => ({ parsed: null, valid: false, issue, statusCorrect: false, levelCorrect: false, drugCorrect: false, sourcesCorrect: false, factsComplete: false, allCorrect: false });
  if (finishReason !== 'stop') return failed(`输出未完整结束：${finishReason ?? '未返回结束标记'}`);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return failed('返回文字不是有效 JSON 对象。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failed('返回值不是 JSON 对象。');
  const item = value as Record<string, unknown>;
  const keys = ['status', 'actual_level', 'mistaken_drug', 'source_ids'];
  if (Object.keys(item).length !== keys.length || !keys.every((key) => Object.hasOwn(item, key))
      || !['resolved', 'insufficient'].includes(item.status as string)
      || !(item.actual_level === null || Number.isInteger(item.actual_level))
      || !(item.mistaken_drug === null || typeof item.mistaken_drug === 'string')
      || !Array.isArray(item.source_ids) || !item.source_ids.every((id) => typeof id === 'string')) {
    return failed('字段缺失、多余或类型不符；需要 status、actual_level、mistaken_drug、source_ids。');
  }
  const parsed = item as Answer;
  const statusCorrect = parsed.status === expected.status;
  const levelCorrect = parsed.actual_level === expected.actual_level;
  // “迷药神仙倒”与药名本身表达同一事实，不把这类前缀当作知识错误。
  const drugName = (name: string | null) => name?.trim().replace(/^[“”"'「『]|[“”"'」』]$/g, '').replace(/^(?:普通的?|一种)?迷药/, '');
  const drugCorrect = drugName(parsed.mistaken_drug) === drugName(expected.mistaken_drug);
  // 引用集合必须完整且没有额外或重复记录，顺序不影响判定。
  const sourcesCorrect = parsed.source_ids.length === expected.source_ids.length
    && new Set(parsed.source_ids).size === parsed.source_ids.length
    && expected.source_ids.every((id) => parsed.source_ids.includes(id));
  const factsComplete = statusCorrect && levelCorrect && drugCorrect;
  return { parsed, valid: true, statusCorrect, levelCorrect, drugCorrect, sourcesCorrect, factsComplete, allCorrect: factsComplete && sourcesCorrect };
}
