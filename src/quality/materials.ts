import { QUALITY_CONDITIONS, type Document, type QualityCase, type QualityCondition } from './contract.ts';
import { FAMILY_FACTS, SOURCES } from '../novel-materials.ts';
export const OUTPUT_RULE = '只依据所附小说原文回答第一章的事实，不用其他时期或人物的信息替代。只返回 JSON 对象，包含 status、age、family_rank、source_ids。status 为 resolved 或 insufficient；age 和 family_rank 为整数或 null；未知字段填 null。source_ids 为支持结论的编号数组，不引用无关或重复编号。';
const key: Document = { id: SOURCES[0].id, text: SOURCES[0].text };
const others = SOURCES.slice(1).map(({ id, text }) => ({ id, text }));
const documents: Record<QualityCondition, Document[]> = {
  short: [key], middle: [...others.slice(0, 15), key, ...others.slice(15)],
  first: [key, ...others], last: [...others, key],
};
export const CASES: QualityCase[] = (Object.keys(QUALITY_CONDITIONS) as QualityCondition[]).map(condition => ({
  id: condition, condition,
  question: '第一章《山边小村》中，韩立当时几岁，在家里排行第几？给出原文来源编号。',
  documents: documents[condition], expected: { status: 'resolved', ...FAMILY_FACTS, source_ids: ['C01'] },
}));
export function caseMessages(item: QualityCase) {
  return [{ role: 'system', content: OUTPUT_RULE },
    { role: 'user', content: `${item.question}\n\n小说原文：\n${item.documents.map(document => `[${document.id}] ${document.text}`).join('\n\n')}` }];
}
