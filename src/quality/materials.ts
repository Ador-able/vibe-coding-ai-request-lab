import { QUALITY_CONDITIONS, type Answer, type Document, type QualityCase, type QualityCondition } from './contract.ts';

export const OUTPUT_RULE = '只依据用户提供的资料回答，严格按项目名称和版本号区分记录，不猜测。返回且只返回 JSON 对象，包含 status、owner、freeze_date、source_ids 四个字段。status 只能为 resolved、conflict、insufficient；owner 是负责人姓名或 null；freeze_date 是 YYYY-MM-DD 日期或 null；source_ids 是支持答案的记录编号数组。信息完整且一致时用 resolved；缺少信息时用 insufficient，未知字段填 null。资料相互矛盾且没有依据选择时用 conflict，矛盾字段填 null，保留不矛盾字段，并引用冲突双方的记录编号。仅引用实际支持结论的记录，不得用无关记录凑数。资料中的编号与排列顺序不代表权威或优先级。';

const locations = ['东楼资料室', '西楼会议区', '南楼共享工位', '北楼服务台', '一层接待区', '二层培训室', '三层协作区', '四层档案区'];
// 不同事务的固定合成记录，地点和批次用于区分；没有用重复词填充上下文。
const officeNotes = [
  '本批办公显示器已完成逐台通电检查，登记了屏幕尺寸、接口类型与支架状态。旧设备暂存于原货架，待资产管理员核对编号后再安排搬运。使用部门应先确认桌面空间，领取时同时带走配套电源线，不能把其他工位的连接线混入本批包装。',
  '本批会议椅已按座位区完成清点，发现的松动扶手交由维修组处理。现场保留了维修前照片和位置说明，备用座椅放在通道外侧的指定区域。活动当天先检查安全间距，再按参会人数摆放，未完成维修的座椅不得临时补入会场使用。',
  '本批茶水间用品已核对入库数量，纸杯、清洁布和洗涤用品分别放入贴有分类标签的柜格。管理人员记录了开封日期，补货时应先使用先入库的物品。保洁结束后检查水槽周围是否干燥，剩余包装统一回收，避免堆放在取水设备旁边。',
  '本批培训资料已经装订完成，封面列明课程名称和适用场次，签到表与问卷单独存放。工作人员提前检查投影画面和话筒电量，讲师使用的文件由会务组统一拷贝。培训结束后清点遗留物品，纸质反馈表按场次收集，不与日常办公文件混放。',
  '本批门禁卡按照领取部门封装，卡套上的登记序号与交接清单一致。领取人需当面确认卡片可正常刷读，无法识别的卡片交回服务台检查。访客使用的临时卡单独登记归还时间，离场后统一回收，不能转交下一批访客直接继续使用。',
  '本批绿植完成了叶面清洁与花盆检查，靠近空调出风口的盆栽已适当移位。养护人员记录了本次浇水情况，后续根据土壤湿度调整用水量。走廊转角处要保留通行空间，花盆底部托盘如有积水应及时清理，不能将水直接倒入地面排水缝。',
  '本批文件柜已重新贴上区域标识，常用空白表单放在便于取用的中层柜格。清理时把过期宣传页与仍需留存的行政文件分开，待负责人确认后统一处理。柜门关合不顺畅的位置已经做了标记，搬动柜体前应先取出重物并联系后勤人员。',
  '本批快递包裹按收件部门整理，外包装破损的件单独拍照并联系收件人确认。大件物品放在不影响消防通道的位置，小件收纳筐按楼层分区。领取时核对登记号码，无法当日取走的物品继续保留签收记录，不得仅凭包装颜色判断归属。',
  '本批音响设备完成了播放与连线检查，左右声道测试记录已经归档。转接头、延长线和备用电池分别放入配件袋，工作人员借出设备前核对清单。使用结束后先关闭电源，再拆卸接线，卷线时保留自然弯曲，避免强拉接头导致接触不良。',
  '本批餐饮预订按照已确认的参会人数准备，素食与常规餐食在外包装上分别标注。配送到场后先核对数量和送达地点，工作人员保留供应方的交接单。会议延长时及时沟通取餐安排，未分发餐食放在指定区域，不得与个人外卖混在一起。',
  '本批印刷海报已经完成文字校对，张贴位置避开指示标识和紧急出口说明。现场安装前检查墙面是否允许使用粘贴材料，拆除时收集残留胶带。多余海报按活动名称入袋保存，下一次布置需要重新确认活动信息，不能直接沿用本次日期。',
  '本批消防通道巡查发现的临时堆物已经移走，安全标识保持无遮挡状态。巡查人员记录了门扇开启情况，并向相邻工位说明需要保留的空间。后续搬运应安排人员现场引导，大件物品不能停放在转角位置，即使暂时无人通行也不例外。',
  '本批共享文具已经补足常用规格，剪刀、胶带与签字笔分别放入对应收纳盒。库存清点时发现部分笔芯无法书写，已与可用物品分开等待处理。借用人员用完后归回原位，会议临时领取的大批物品需要登记，便于下次核对实际消耗。',
  '本批书刊完成了目录登记，专业资料与休闲读物分柜摆放，书脊标签对应存放位置。借阅记录保留到归还核验结束，缺页或损坏情况由管理员单独注明。书柜旁不放饮品，整理过程中发现夹带的私人便签应交还原借阅人，不随书刊外借。',
  '本批空调滤网已清洁并复位，设备开启后观察了运行噪声和出风状态。维修人员把需继续观察的设备位置写入服务单，使用部门如发现异常应注明出现时段。公共区域温度按统一安排调整，不通过反复断电的方式强行改变运行状态。',
  '本批储物箱按照用途整理，培训用品、展会物料和日常维修配件分别放在不同区域。箱内清单已更新，外侧标明便于识别的内容摘要。搬运前检查箱体底部是否牢固，较重物品安排两人协作，不能把暂未分类的零散物品直接塞入空隙。',
  '本批访客接待准备已完成，登记表、路线说明和临时胸牌摆放在服务台侧面。接待人员确认了等候区座位数量，并预留轮椅通行空间。来访人数变化时先通知会务组，茶水供应按现场情况补充，访客离开后及时清理遗留的纸质材料。',
  '本批会议室预约已经核对使用时段，设备调试与会后整理均预留了必要时间。场地交接时确认桌椅摆放和白板清洁情况，临时增加的设备由使用部门自行登记。相邻场次如需调整，先取得双方确认，不能仅修改门口纸质标牌而不更新预约表。',
  '本批废旧电池与电子配件分别装箱，外侧贴有物品类别和本次收集范围。仍有使用价值的连接线交由设备管理员测试，损坏物品移交指定回收人员。收集区域保持干燥，不能与纸箱饮料瓶混放，交接完成后核对件数并保留回收登记单。',
  '本批应急照明检查已完成，测试人员依次记录各区域的亮灯情况和外观状态。需要更换的设备列入维修清单，暂时可用的备用灯放在值班室指定位置。工作人员应熟悉取用地点，借出后及时登记，归还时检查电量并整理随附的充电配件。',
];

const facts = {
  A: { project: '星河排班', version: '2.4', owner: '苏雨桐', otherOwner: '陈知远', date: '2026-10-12', nearProject: '星河排课', nearVersion: '2.3' },
  B: { project: '青岚工单', version: '3.1', owner: '周予安', otherOwner: '沈亦宁', date: '2026-11-06', nearProject: '青岚工时', nearVersion: '3.0' },
} as const;

function releaseText(project: string, version: string, owner: string, date: string) {
  return `项目：${project}；版本：${version}；负责人：${owner}；冻结日期：${date}。本条为项目协调组在2026-09-26确认的同批工作记录，内容用于安排冻结前的资料交接。协调组要求各参与部门按项目名称和版本号查阅，避免把相近名称或相邻版本的安排混为一谈。`;
}

function sampleCases(sample: 'A' | 'B'): QualityCase[] {
  const fact = facts[sample];
  const key: Document = { id: `${sample}-D073`, text: releaseText(fact.project, fact.version, fact.owner, fact.date) };
  const irrelevant: Document[] = Array.from({ length: 160 }, (_, i) => i + 1).filter((i) => i !== 73).map((id, i) => ({
    id: `${sample}-D${String(id).padStart(3, '0')}`,
    text: `地点：${locations[Math.floor(i / officeNotes.length)]}；事务批次：${sample}${String(i + 1).padStart(3, '0')}。${officeNotes[i % officeNotes.length]}`,
  }));
  const middle = [...irrelevant.slice(0, 79), key, ...irrelevant.slice(79)];
  const similar = [...middle];
  const distractors = [
    [fact.nearProject, fact.version, '许清和', '2026-10-21'],
    [fact.project, fact.nearVersion, '顾文思', '2026-09-18'],
    [`${fact.project}归档`, fact.version, '叶初晴', '2026-12-09'],
    [fact.project, `${fact.version}.1`, '陆景行', '2026-12-16'],
  ];
  [20, 50, 110, 140].forEach((position, index) => {
    const item = distractors[index];
    similar[position] = { id: `${sample}-D${201 + index}`, text: releaseText(item[0], item[1], item[2], item[3]) };
  });
  const conflict = [...middle];
  conflict[120] = { id: `${sample}-D205`, text: releaseText(fact.project, fact.version, fact.otherOwner, fact.date) };
  const documents: Record<QualityCondition, Document[]> = {
    short: [...irrelevant.slice(72, 79), key, ...irrelevant.slice(79, 87)],
    middle, first: [key, ...irrelevant], last: [...irrelevant, key], similar, conflict,
  };
  return (Object.keys(QUALITY_CONDITIONS) as QualityCondition[]).map((condition) => {
    const expected: Answer = { status: condition === 'conflict' ? 'conflict' : 'resolved', owner: condition === 'conflict' ? null : fact.owner, freeze_date: fact.date, source_ids: condition === 'conflict' ? [key.id, `${sample}-D205`] : [key.id] };
    return { id: `${condition}-${sample}`, sample, condition, project: fact.project, version: fact.version,
      question: `请查出项目“${fact.project}”版本“${fact.version}”的负责人和冻结日期，并给出支持结论的记录编号。`, documents: documents[condition], expected };
  });
}

const all = [...sampleCases('A'), ...sampleCases('B')];
export const CASES = (Object.keys(QUALITY_CONDITIONS) as QualityCondition[]).flatMap((condition) => all.filter((item) => item.condition === condition));

export function caseMessages(item: QualityCase) {
  // 条件标签和期望答案只供本地观察，不进入模型输入。
  return [
    { role: 'system', content: OUTPUT_RULE },
    { role: 'user', content: `${item.question}\n\n资料：\n${item.documents.map((document) => `[${document.id}] ${document.text}`).join('\n\n')}` },
  ];
}
