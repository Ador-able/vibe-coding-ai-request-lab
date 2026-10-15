import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { SOURCES } from '../src/novel-materials.ts';

// 只整理已有原文与实录，不发送模型请求。
const material = SOURCES[1];
const rule = '只依据所附《凡人修仙传》原文整理梗概，区分人物当时所知、叙述交代与尚未发生的事。不续写，不把未来安排写成已完成。';
const firstTask = `把下面原文整理成三段梗概。\n\n[${material.id}] ${material.title}\n${material.text}`;
const draft = [
  '韩立第一次离家，想着挣到钱后回来陪伴父母。三叔带他赶路三天来到青牛镇，将他安置在春香酒楼后院休息，嘱咐他不要乱跑。',
  '韩立在院中等待内门管事。两天后，七玄门王护法来到酒楼，称长老命他亲自领人；三叔请他照应韩立，并递给他一个袋子。',
  '王护法答应路上照顾，催促出发。韩立随后坐进挤着近三十名孩童的车厢，观察不同出身的同伴；本片段没有写出入门考验结果。',
].join('\n\n');
const followup = '把刚才的三段梗概改成两段，不新增事实，不把人物未曾知道的后事写成当时所知。';
const history = [{ role: 'user', content: firstTask }, { role: 'assistant', content: draft }, { role: 'user', content: followup }];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const teacher = { kind: '教师结构示意，未向三个接口发起比较请求', material: { ...material, textSha256: sha256(material.text) },
  rule, firstTask, teacherDraft: draft, followup, forms: {
    Completions: { prompt: `规则：${rule}\n\n用户任务：${firstTask}\n\n助手草稿：${draft}\n\n用户追问：${followup}\n\n助手：` },
    ChatCompletions: { messages: [{ role: 'developer', content: rule }, ...history] },
    Responses: { instructions: rule, input: history },
  } };
const lines = material.text.split(/\r?\n/);
const wish = lines.find(line => line.includes('等挣到了大钱就马上赶回来'));
const future = lines.find(line => line.includes('韩立从未想到'));
const departure = lines.find(line => line.includes('还是赶紧上路吧'));
const continuation = { kind: '教师表达与检索练习，未运行Responses或Embeddings',
  H1: { instructions: rule, input: history },
  H2: { previous_response_id: 'teacher-previous-response', instructions: rule, input: followup },
  H3: { previous_response_id: 'teacher-previous-response', input: followup },
  question: '韩立刚离家时，已经知道自己会走上修仙之路了吗？',
  evidence: [
    { id: 'K1', kind: 'C02人物当时的愿望', text: wish },
    { id: 'K2', kind: 'C02叙述交代', text: future },
    { id: 'K3', kind: 'C02实际出发', text: departure },
    { id: 'K4', kind: '教师构造的错误读法，不是原著句子或已采用设定', text: '韩立离家时已经知道自己会修仙。' },
  ] };
const originalPath = 'records/凡人修仙传/20261014/14-context-start.json';
const original = readFileSync(originalPath);
const envelope = JSON.parse(original.toString('utf8'));
const run = JSON.parse(envelope.body).run;
const call = run.requests[0].responseMessage.tool_calls[0];
const output = JSON.parse(run.tools[0].result);
const secondBody = JSON.parse(run.requests[1].requestBody);
const toolMessage = secondBody.messages.find(message => message.role === 'tool');
const audit = { kind: '复用2026-10-14既有凡人实录，没有新增模型请求', originalPath,
  originalSha256: sha256(original), recordedAt: run.startedAt, runId: run.id,
  first: { content: run.requests[0].responseMessage.content, toolName: call.function.name, arguments: call.function.arguments,
    callId: call.id, finishReason: run.requests[0].finishReason },
  tool: { callId: run.tools[0].callId, sourceId: output.source_id, title: output.title, textSha256: sha256(output.text) },
  second: { toolCallId: toolMessage.tool_call_id, finishReason: run.requests[1].finishReason, answer: run.answer },
  requestCount: run.requests.length, idsMatch: call.id === run.tools[0].callId && call.id === toolMessage.tool_call_id,
  originalMatchesCorpus: output.text === SOURCES[0].text,
  limits: '首请求指定工具和C01，观察真实调用与回传关联；不评价自主工具选择，不代表已调用Responses。',
  responsesItems: [
    { type: 'function_call', call_id: 'teacher-novel-01', name: call.function.name, arguments: call.function.arguments },
    { type: 'function_call_output', call_id: 'teacher-novel-01', output: run.tools[0].result },
  ],
  responsesItemsKind: '依据真实Chat调用转换的教师表示示意；teacher-novel-01不是实际Responses调用编号',
};
const materialDirectory = resolve('materials/接口表达');
const recordDirectory = resolve('records/凡人修仙传/20261015/121-接口表达');
mkdirSync(materialDirectory, { recursive: true }); mkdirSync(recordDirectory, { recursive: true });
writeFileSync(resolve(materialDirectory, '121-完整材料与三种表达.json'), JSON.stringify(teacher, null, 2) + '\n');
writeFileSync(resolve(materialDirectory, '121-历史接续与检索练习.json'), JSON.stringify(continuation, null, 2) + '\n');
writeFileSync(resolve(recordDirectory, '14-context-start.json'), original);
writeFileSync(resolve(recordDirectory, '复用实录核对.json'), JSON.stringify(audit, null, 2) + '\n');
writeFileSync(resolve(recordDirectory, '阅读说明.md'), '# 模型接口：凡人原文与既有调用\n\n材料与三种接口表达在 materials/接口表达。它们是完整教师示意，没有执行三接口对照，也没有调用Responses或Embeddings。\n\n14-context-start.json逐字复制2026-10-14的原始请求观察记录，未重做模型。复用实录核对.json保存原件哈希、两次真实Chat请求、工具返回及对应编号。首请求指定工具和C01，回答为“十岁”。本轮只整理证据，不把它改称2026-10-15新实测。\n');
console.log(JSON.stringify({ materialId: material.id, reusedRunId: run.id, idsMatch: audit.idsMatch,
  originalMatchesCorpus: audit.originalMatchesCorpus, cloudModelRequests: 0 }));
