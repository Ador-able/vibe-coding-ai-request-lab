import { QUALITY_CONDITIONS, type Document, type QualityCase, type QualityCondition } from './contract.ts';
import { SOURCES } from '../novel-materials.ts';

export const OUTPUT_RULE = '只依据所附小说原文回答，区分故事发生的时点、人物说辞和叙述确认的事实。只返回 JSON 对象，包含 status、actual_level、mistaken_drug、source_ids。status 为 resolved 或 insufficient；actual_level 为整数或 null；mistaken_drug 只写药名或 null，不添加解释。未知字段填 null。source_ids 为支持结论的编号数组，不引用无关或重复编号。';
const source = SOURCES.find(item => item.id === 'C28')!;
const key: Document = { id: source.id, text: source.text };
const others = SOURCES.filter(item => item.id !== key.id).map(({ id, text }) => ({ id, text }));
const documents: Record<QualityCondition, Document[]> = {
  short: [key], middle: [...others.slice(0, 15), key, ...others.slice(15)],
  first: [key, ...others], last: [...others, key],
};
export const CASES: QualityCase[] = (Object.keys(QUALITY_CONDITIONS) as QualityCondition[]).map(condition => ({
  id: condition, condition,
  question: '第三十二章《豪气生》中，韩立回屋睡醒后，当时实际上已练成长春功第几层？墨大夫试射缴获的铁筒前，原以为筒里装的是哪种药？给出原文来源编号。',
  documents: documents[condition], expected: { status: 'resolved', actual_level: 4, mistaken_drug: '神仙倒', source_ids: ['C28'] },
}));
export function caseMessages(item: QualityCase) {
  return [{ role: 'system', content: OUTPUT_RULE },
    { role: 'user', content: `${item.question}\n\n小说原文：\n${item.documents.map(document => `[${document.id}] ${document.text}`).join('\n\n')}` }];
}
