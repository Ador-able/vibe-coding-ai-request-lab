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
  return answerMessages(`从本机读回的摘要：\n${saved.note.text}\n来源：${saved.note.source_ids.map((id) => `[${id}]`).join(' ')}`);
}

export async function runFlow(config: ModelConfig, result: FlowResult, signal: AbortSignal, saved?: SavedNote) {
  async function call(messages: { role: string; content: string }[], step: string, json = false) {
    // 输出预算包含推理；各流程只要求一个简短结果。
    const maxTokens = step === '现场压缩资料' ? 8192 : 2048;
    const requestBody = JSON.stringify({ model: config.model, messages, stream: false,
      temperature: 0, max_tokens: maxTokens, ...(json ? { response_format: { type: 'json_object' } } : {}) });
    const record = { step, startedAt: new Date().toISOString(), requestBody };
    result.requests.push(record);
    const message = await sendRecordedRequest(config, record, signal);
    if (result.requests.at(-1)!.finishReason === 'length') {
      throw new ModelError('MODEL_RESPONSE_INCOMPLETE', `本步达到 ${maxTokens} token 输出上限（含推理与正文），尚未完整结束。已保留原始响应与用量，不继续后续步骤。`);
    }
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
        { role: 'system', content: '从目录选择回答问题所需的资料编号，只返回 JSON 对象 {"source_ids":["编号"]}。只选相关资料，不重复，不回答问题。' },
        { role: 'user', content: `${QUESTION}\n\n资料目录：\n${JSON.stringify(CATALOG)}` },
      ], '选择资料编号', true);
      result.selectedIds = parseSelectedIds(selection);
      material = sourceText(result.selectedIds);
      break;
    }
    case 'summary': {
      result.summary = await call([
        { role: 'system', content: '将全部小说原文压缩成约300字的阅读进度摘要，记录主要事件、人物关系和未决事项，附来源编号。不补造情节。只输出摘要。' },
        { role: 'user', content: `原文：\n${sourceText(SOURCES.map((source) => source.id))}` },
      ], '现场压缩资料');
      material = `以下是本次模型现场生成的摘要，本轮未附原文：\n${result.summary}`;
      break;
    }
    case 'note':
      if (!saved) throw new ModelError('CONFIG_MISSING', '请先核对并保存教学摘要。', 409);
      result.note = saved;
      result.answer = await call(noteMessages(saved), '回答问题');
      return;
  }
  result.answer = await call(answerMessages(material), '回答问题');
}
