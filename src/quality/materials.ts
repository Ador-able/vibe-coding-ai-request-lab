import { QUALITY_CONDITIONS, type Document, type QualityCase, type QualityCondition } from './contract.ts';
import { SOURCES } from '../novel-materials.ts';

export const OUTPUT_RULE = '只依据所附小说原文回答，区分故事发生的时点、人物说辞和叙述确认的事实。只返回 JSON 对象，包含 status、actual_level、mistaken_drug、source_ids。status 为 resolved 或 insufficient；actual_level 为整数或 null；mistaken_drug 只写药名或 null，不添加解释。无法从材料确定的事实填 null。source_ids 为支持答案的资料 ID 数组：只使用各段原文开头方括号内的 ID，格式为字母 C 后接两位数字；不要填写章节名、章序或材料排列序号。同一条资料支持两项答案时只引用一次，不引用无关资料；没有依据时返回空数组。';
const source = SOURCES.find(item => item.id === 'C28')!;
const key: Document = { id: source.id, text: source.text };
const others = SOURCES.filter(item => item.id !== key.id).map(({ id, text }) => ({ id, text }));
const documents: Record<QualityCondition, Document[]> = {
  short: [key], middle: [...others.slice(0, 15), key, ...others.slice(15)],
  first: [key, ...others], last: [...others, key],
};
export const CASES: QualityCase[] = (Object.keys(QUALITY_CONDITIONS) as QualityCondition[]).map(condition => ({
  id: condition, condition,
  question: '韩立回屋睡醒后，当时实际上已练成长春功第几层？墨大夫试射缴获的铁筒前，原以为筒里装的是哪种药？source_ids 请填写支持答案的原文资料 ID，使用各段开头的方括号标记。',
  documents: documents[condition], expected: { status: 'resolved', actual_level: 4, mistaken_drug: '神仙倒', source_ids: ['C28'] },
}));
export function caseMessages(item: QualityCase) {
  return [{ role: 'system', content: OUTPUT_RULE },
    { role: 'user', content: `${item.question}\n\n小说原文：\n${item.documents.map(document => `[${document.id}] ${document.text}`).join('\n\n')}` }];
}
