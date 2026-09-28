import { ModelError, type ModelConfig } from '../model.ts';
import { isObject, sendRecordedRequest } from '../recorded-model.ts';
import { answerMessages, CATALOG, QUESTION, SOURCE_MAP, SOURCES, sourceText } from './materials.ts';
import type { FlowResult, SavedNote } from './contract.ts';

export function parseSelectedIds(raw: string): string[] {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new ModelError('MODEL_RESPONSE_INVALID', '选取资料的返回不是有效 JSON，未继续读取。'); }
  if (!isObject(value) || Object.keys(value).length !== 1 || !Array.isArray(value.source_ids)
      || !value.source_ids.length || !value.source_ids.every((id) => typeof id === 'string' && SOURCE_MAP.has(id))
      || new Set(value.source_ids).size !== value.source_ids.length) {
    throw new ModelError('MODEL_RESPONSE_INVALID', '选取资料的编号为空、重复或不存在，未继续读取。');
  }
  return value.source_ids;
}

export function noteMessages(saved: SavedNote) {
  return answerMessages(`人工核对并保存的任务便笺（并非本轮模型生成；确认时间${saved.confirmedAt}）：\n${JSON.stringify(saved.note)}\n\n便笺所指原文（请回到原文核对条件）：\n${sourceText(saved.note.sources.map((source) => source.id))}`);
}

export async function runFlow(config: ModelConfig, result: FlowResult, signal: AbortSignal, saved?: SavedNote) {
  async function call(messages: { role: string; content: string }[], step: string, json = false) {
    const requestBody = JSON.stringify({ model: config.model, messages, stream: false, enable_thinking: false,
      temperature: 0, max_tokens: json ? 256 : 1024, ...(json ? { response_format: { type: 'json_object' } } : {}) });
    const record = { step, startedAt: new Date().toISOString(), requestBody };
    result.requests.push(record);
    const message = await sendRecordedRequest(config, record, signal);
    if (!isObject(message) || typeof message.content !== 'string' || !message.content.trim()) {
      throw new ModelError('MODEL_RESPONSE_INVALID', '模型没有返回可识别的文字，已有响应保留在记录中。');
    }
    if (result.requests.at(-1)!.finishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '本步输出没有完整结束，已保留原始返回，不继续后续步骤。');
    if (Array.isArray(message.tool_calls) && message.tool_calls.length) throw new ModelError('MODEL_RESPONSE_INVALID', '模型返回了未提供的工具调用，程序没有执行。');
    return message.content;
  }
  let material: string;
  switch (result.flow) {
    case 'full': material = sourceText(SOURCES.map((source) => source.id)); break;
    case 'retrieve': {
      const selection = await call([
        { role: 'system', content: '根据当前任务和资料目录，选择需要读取原文的记录编号。返回且只返回 JSON 对象 {"source_ids":["编号"]}。只使用目录中存在的编号，不重复；选择应覆盖做决定所需的条件、时间和最新进度。此步不回答任务。' },
        { role: 'user', content: `${QUESTION}\n\n资料目录（标题、日期、主题与片段，不是原文）：\n${JSON.stringify(CATALOG)}` },
      ], '选择资料编号', true);
      result.selectedIds = parseSelectedIds(selection);
      material = sourceText(result.selectedIds);
      break;
    }
    case 'summary': {
      result.summary = await call([
        { role: 'system', content: '为指定任务整理一份不超过500字的任务摘要。保留影响决定的具体日期、时段、数字、批准条件、未决事项和来源编号，不把待确认写成已确认。无关内容可省略，不补造信息。此步只整理摘要，不替用户作决定。' },
        { role: 'user', content: `${QUESTION}\n\n原文：\n${sourceText(SOURCES.map((source) => source.id))}` },
      ], '生成任务摘要');
      material = `以下是模型整理的任务摘要，本轮未附原文：\n${result.summary}`;
      break;
    }
    case 'note':
      if (!saved) throw new ModelError('CONFIG_MISSING', '请先核对并保存教学便笺。', 409);
      result.note = saved;
      result.answer = await call(noteMessages(saved), '回答问题');
      return;
  }
  result.answer = await call(answerMessages(material), '回答问题');
}
