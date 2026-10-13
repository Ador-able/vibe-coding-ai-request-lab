import { QUALITY_CONDITIONS, type Answer, type Document, type QualityCase, type QualityCondition } from './contract.ts';
import { INVENTORY, NOVEL, SCENE_NOTES } from '../novel-materials.ts';

export const OUTPUT_RULE = '只依据提供的小说教学资料回答，严格按地点与药材名称区分记录，不猜测。只返回 JSON 对象，包含 status、registered_count、actual_count、source_ids。status 只能为 resolved、conflict、insufficient；registered_count 和 actual_count 为整数或 null；source_ids 是支持结论的记录编号数组。信息完整一致时用 resolved；缺少信息时用 insufficient，未知字段填 null。同一对象的记录矛盾且无法选择时用 conflict，矛盾字段填 null，保留一致字段，并引用冲突双方。仅引用支持结论的记录，不得添加无关或重复编号。记录的排列顺序和编号不代表权威，教学样例之间互不补充依据。';

function inventoryText(location: string, herb: string, registered: number, actual: number, sample: 'A' | 'B') {
  const opening = sample === 'A' ? '同次清点记录' : '本次清点核对单';
  return `地点：${location}；药材：${herb}；登记数量：${registered}株；实物数量：${actual}株。${opening}：登记簿和现场物品分别核对，数字适用于本条标明的地点与药材。收药与领用分栏填写，清点后将记录放回桌边。领用栏目前没有填写内容，核对人将本条与原始收药单放在一起。`;
}

function sampleCases(sample: 'A' | 'B'): QualityCase[] {
  const key: Document = { id: `${sample}-D073`, text: inventoryText('炼丹房', '凝露草', INVENTORY.registered_count, INVENTORY.actual_count, sample) };
  const irrelevant: Document[] = Array.from({ length: 160 }, (_, i) => i + 1).filter((i) => i !== 73).map((id, i) => {
    const [title, text] = SCENE_NOTES[(i + (sample === 'A' ? 0 : 7)) % SCENE_NOTES.length];
    return { id: `${sample}-D${String(id).padStart(3, '0')}`, text: `场景备忘${Math.floor(i / SCENE_NOTES.length) + 1}：${title}。${text}` };
  });
  const middle = [...irrelevant.slice(0, 79), key, ...irrelevant.slice(79)];
  const similar = [...middle];
  // 近似对象不是目标的新版本；四条干扰仅替换无关资料。
  const distractors = [['药园', '凝露草', 14, 13], ['炼丹房', '止血草', 8, 8], ['药库', '凝露草', 18, 16], ['炼丹房', '清心草', 6, 5]] as const;
  [20, 50, 110, 140].forEach((position, index) => {
    const [location, herb, registered, actual] = distractors[index];
    similar[position] = { id: `${sample}-D${201 + index}`, text: inventoryText(location, herb, registered, actual, sample) };
  });
  const conflict = [...middle];
  // 冲突条件人为置入同等效力的不同实物数，只用于对照，不是小说定稿。
  conflict[120] = { id: `${sample}-D205`, text: inventoryText('炼丹房', '凝露草', INVENTORY.registered_count, 10, sample) };
  const documents: Record<QualityCondition, Document[]> = {
    short: [...irrelevant.slice(72, 79), key, ...irrelevant.slice(79, 87)],
    middle, first: [key, ...irrelevant], last: [...irrelevant, key], similar, conflict,
  };
  return (Object.keys(QUALITY_CONDITIONS) as QualityCondition[]).map((condition) => {
    const expected: Answer = { status: condition === 'conflict' ? 'conflict' : 'resolved', registered_count: INVENTORY.registered_count, actual_count: condition === 'conflict' ? null : INVENTORY.actual_count, source_ids: condition === 'conflict' ? [key.id, `${sample}-D205`] : [key.id] };
    return { id: `${condition}-${sample}`, sample, condition, location: '炼丹房', herb: '凝露草',
      question: `${NOVEL}的教学资料中，炼丹房的灵草（凝露草），收药记录登记多少株，现场实物有多少株？给出支持结论的记录编号。`, documents: documents[condition], expected };
  });
}

const all = [...sampleCases('A'), ...sampleCases('B')];
export const CASES = (Object.keys(QUALITY_CONDITIONS) as QualityCondition[]).flatMap((condition) => all.filter((item) => item.condition === condition));

export function caseMessages(item: QualityCase) {
  // 条件标签和期望答案只供本地观察，不进入模型输入。
  return [
    { role: 'system', content: OUTPUT_RULE },
    { role: 'user', content: `${item.question}\n\n本实验教学资料：\n${item.documents.map((document) => `[${document.id}] ${document.text}`).join('\n\n')}` },
  ];
}
