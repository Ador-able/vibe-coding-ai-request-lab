import { randomUUID } from 'node:crypto';
import { ModelError, readConfig } from '../model.ts';
import { isObject, sendRecordedRequest } from '../recorded-model.ts';
import { JSON_SCHEMA } from './schema.ts';
import { inspectResponse } from './inspect.ts';
import { MODES, type Mode, type StructuredRun } from './contract.ts';

export const DEFAULT_MODEL = 'qwen3.7-flash-2026-07-15';
export const modelName = (env: NodeJS.ProcessEnv) => env.STRUCTURED_MODEL?.trim() || DEFAULT_MODEL;
const SYSTEM = `从会议纪要提取会议结束时仍需执行的待办，只依据原文。已完成的状态、被取消的安排或明确不用执行的任务不列入items。没有待办时返回items空数组。负责人或截止时间未确定时保留字段并填null，不猜测；dueText沿用原文时间文字，不推算日历日期。evidence逐字引用一段连续原句，不改写。只输出JSON，不加围栏或说明。输出遵守以下JSON Schema：\n${JSON.stringify(JSON_SCHEMA)}`;

export function buildStructuredBody(model: string, mode: Mode, material: string): string {
  return JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: material }],
    stream: false, enable_thinking: false, temperature: 0, max_tokens: 1024,
    ...(mode === 'object' ? { response_format: { type: 'json_object' } }
      : mode === 'strict' ? { response_format: { type: 'json_schema', json_schema: { name: 'meeting_tasks', strict: true, schema: JSON_SCHEMA } } } : {}),
  });
}

export async function extractTasks(material: string, mode: Mode, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<StructuredRun> {
  const run: StructuredRun = { id: randomUUID(), mode, material, request: null, rawAnswer: null, inspection: null };
  try {
    // 独立实验型号覆盖，不修改其它课程使用的MODEL配置。
    const config = readConfig({ ...env, MODEL: modelName(env) });
    run.request = { step: MODES[mode], startedAt: new Date().toISOString(), requestBody: buildStructuredBody(config.model, mode, material) };
    const message = await sendRecordedRequest(config, run.request, signal);
    run.rawAnswer = isObject(message) && typeof message.content === 'string' ? message.content : null;
    run.inspection = inspectResponse(message, run.request.finishReason, material);
  } catch (error) {
    const failure = error instanceof ModelError ? error : new ModelError('MODEL_RESPONSE_INVALID', '本次处理未完成，已有记录保留。');
    run.error = { code: failure.code, message: failure.message };
  }
  return run;
}
