import { INVENTORY_TEXT, NOVEL, SCENE_NOTES } from '../novel-materials.ts';

export type Source = { id: string; title: string; date: string; topic: string; snippet: string; text: string };
export const QUESTION = `为${NOVEL}续写一个120—180字的片段：林青在炼丹房帮忙，发现灵草的收药记录与实物数量不符，准备复核。保持当前修为，不揭示灵草去向，不新增场外人物救场；片段后列出仍待核查的事项并标注来源。`;
export const ANSWER_RULE = '只依据本次资料写小说教学片段。把已确认事实、人物猜测和未决问题分开，不把尚未查清的事写成真相。不要新增改变主线的关键事实。文末用简短的核对说明标注依据编号，如[C01]；材料缺失时说明无法确定的设定，不自行补定。';
export const SOURCES: Source[] = [
  { id: 'C01', title: '当前情节', date: '2026-10-13', topic: '章节接续', snippet: '林青正在做什么，以及本段要推进的事情。', text: '《青岚修仙录》的当前情节是林青在青岚宗炼丹房帮忙。他发现灵草收药记录与药盘里的数量不符，准备复核。本段接着写他检查药盘和记录的行动，停在仍需核查的问题上。' },
  { id: 'C02', title: '林青的人物设定', date: '2026-10-13', topic: '人物与修为', snippet: '身份、当前修为和长线目标。', text: '林青是青岚宗外门弟子，当前修为炼气三层，长线目标是筑基。他眼下仍要完成分派的杂务，修炼与日常生活交织。本段不会突破修为，也没有突然获得新功法或法宝的安排。' },
  { id: 'C03', title: '炼丹房收药与清点记录', date: '2026-10-13', topic: '灵草数量', snippet: '收药登记、现场清点与领用记录。', text: INVENTORY_TEXT },
  { id: 'C04', title: '本段行动范围', date: '2026-10-13', topic: '续写要求', snippet: '复核的具体行动与人物出场范围。', text: '本段由林青自己核对药盘和记录，可以重新数一遍、查看药盘边角、翻看收药及领用栏，再记下差异。不新增场外人物替他解释或解决问题，不用长老突然出现、传音指点等方式结束调查。' },
  { id: 'C05', title: '尚未查明的事情', date: '2026-10-13', topic: '未决问题', snippet: '数量差异能说明什么，哪些原因尚未确定。', text: '现有资料不能判断少的一株灵草去了哪里。领用记录为空，不足以证明无人领过，也不足以认定有人偷取或隐瞒。本段不揭示灵草去向；准备回查的事项仍是下一步，不写成已经得到确认的答案。' },
  ...SCENE_NOTES.slice(0, 5).map(([title, text], i) => ({ id: `C${String(i + 6).padStart(2, '0')}`, title: `${title}环境资料`, date: '2026-10-12', topic: '宗门日常', snippet: `${title}的环境与日常活动。`, text })),
];
export const SOURCE_MAP = new Map(SOURCES.map((source) => [source.id, source]));
export const CATALOG = SOURCES.map(({ text: _text, ...metadata }) => metadata);
export function sourceText(ids: string[]) {
  return ids.map((id) => { const source = SOURCE_MAP.get(id)!; return `[${id}] ${source.title} · ${source.date}\n${source.text}`; }).join('\n\n');
}
export function answerMessages(material: string) {
  return [{ role: 'system', content: ANSWER_RULE }, { role: 'user', content: `${QUESTION}\n\n本次可用资料：\n${material}` }];
}

// 人工教学摘要须经读者核对后保存，不是模型的历史回答。
export const TEACHING_NOTE = {
  goal: '接续林青在炼丹房核对灵草的片段，保留人物设定与未决问题。',
  confirmed: [
    { text: '林青在青岚宗炼丹房帮忙，发现收药记录与现场数量不符，准备复核。', source_ids: ['C01'] },
    { text: '林青是青岚宗外门弟子，炼气三层，长线目标筑基；本段不突破修为。', source_ids: ['C02'] },
    { text: '凝露草是一种灵草，收药记录12株，现场实际11株，领用记录为空。', source_ids: ['C03'] },
    { text: '本段由林青自己核对，不新增场外人物救场，不揭示灵草去向。', source_ids: ['C04', 'C05'] },
  ],
  pending: [
    { text: '少的一株灵草去了哪里仍不清楚；记录空白不能证明无人领过或有人偷取。', source_ids: ['C03', 'C05'] },
  ],
  next_steps: ['写出重新清点与翻看记录的行动。', '留下继续核对的事项，不预设调查结果。'],
  sources: ['C01', 'C02', 'C03', 'C04', 'C05'].map((id) => ({ id, date: SOURCE_MAP.get(id)!.date })),
};
