export const FACTS = [
  '时间：周六14:00—16:00；地点：社区图书馆一层。',
  '共有30个家庭名额，活动免费，家长和孩子共同阅读。',
  '每个家庭带一本愿意分享的书；孩子可以暂时离开阅读区再回来。',
  '报名方式尚未提供。',
] as const;
export const GOAL = '面向第一次参加的家庭，语言朴素明确，帮助家长判断是否愿意参加；不宣传阅读能力提升。';
export const SYSTEM = `为教学虚构的社区图书馆活动生成两份不同的短文案，供人比较和自行编辑。只采用用户给定事实，不补造日期、报名方式、名人、往期数据或活动规则；未知就是未知，不写成不存在。
只返回一个JSON对象，严格包含options数组，恰好两个对象。第一个direction必须为“信息优先”，第二个必须为“参与感优先”。每项恰好包含direction、title、text、reason、tradeoff、unknowns六个字符串字段。
title为简洁标题；text为约100字的活动介绍；reason为采用该方向的理由；tradeoff为这样写牺牲了什么或需要留意什么；unknowns为仍需向组织者确认的部分。后三项各用一句简短中文。理由与取舍是建议，不声称经过独立事实核验。不选出唯一赢家，不声称内容已发布。`;
export function requestBody(model: string) {
  return JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `独立给定资料（教学虚构）：\n${FACTS.join('\n')}\n\n目标：${GOAL}` }],
    stream: false, enable_thinking: false, temperature: 0, max_tokens: 1536, response_format: { type: 'json_object' } });
}
