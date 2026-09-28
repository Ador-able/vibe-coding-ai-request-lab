import { Router, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ModelError, readConfig } from '../model.ts';
import { CONDITIONS, FIRST_QUESTION, type Condition, type ContextResponse, type ExperimentRun, type Message } from './contract.ts';
import { callContextModel } from './model.ts';
import { executeReleaseTool, LabError, projectHistory, SYSTEM_RULE } from './scenario.ts';

type Session = { firstRound: ExperimentRun; history: Message[]; runs: ExperimentRun[] };

export function createContextRouter(env: NodeJS.ProcessEnv) {
  const router = Router();
  // 历史由本机服务持有；浏览器只能选条件，不能回传或改写工具结果。
  const sessions = new Map<string, Session>();

  async function run(res: Response, label: string, operation: (record: ExperimentRun, signal: AbortSignal) => Promise<Partial<ContextResponse>>) {
    const record: ExperimentRun = { id: randomUUID(), label, startedAt: new Date().toISOString(), answer: null, requests: [], tools: [] };
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      const state = await operation(record, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]));
      if (!res.destroyed) res.json({ ok: true, run: record, ...state } satisfies ContextResponse);
    } catch (error) {
      const failure = error instanceof ModelError || error instanceof LabError ? error
        : new LabError('EXPERIMENT_FAILED', '本轮实验未能完成，请重试。');
      record.error = { code: failure.code, message: failure.message };
      if (!res.destroyed) res.status(failure.httpStatus).json({ ok: false, run: record } satisfies ContextResponse);
    } finally { res.off('close', cancel); }
  }

  router.post('/start', async (_req, res) => {
    await run(res, '首轮：查询发布时间', async (record, signal) => {
      const config = readConfig(env);
      const history: Message[] = [{ role: 'system', content: SYSTEM_RULE }, { role: 'user', content: FIRST_QUESTION }];
      const instruction = await callContextModel(config, history, { type: 'function', function: { name: 'get_release_info' } }, record.requests, '请求工具调用', signal);
      history.push(instruction);
      const call = instruction.tool_calls![0];
      const result = executeReleaseTool(call);
      record.tools.push({ callId: call.id, name: call.function.name, arguments: call.function.arguments, result: result.content });
      history.push(result);
      const answer = await callContextModel(config, history, 'none', record.requests, '根据工具结果回答', signal);
      history.push(answer);
      record.answer = answer.content;
      const sessionId = randomUUID();
      sessions.set(sessionId, { firstRound: record, history, runs: [] });
      return { sessionId, firstRound: record, runs: [] };
    });
  });

  router.post('/follow-up', async (req, res) => {
    await run(res, '追问：版本负责人', async (record, signal) => {
      const { sessionId, condition } = req.body ?? {};
      if (typeof sessionId !== 'string' || typeof condition !== 'string'
          || !Object.hasOwn(CONDITIONS, condition)) {
        throw new LabError('CONTEXT_INVALID', '请先建立首轮记录，再选择一种上下文条件。', 400);
      }
      const session = sessions.get(sessionId);
      if (!session) throw new LabError('SESSION_MISSING', '本机服务中没有这份首轮历史，请重新建立首轮记录。', 404);
      record.condition = condition as Condition;
      record.label = CONDITIONS[record.condition].name;
      session.runs.push(record);
      const answer = await callContextModel(readConfig(env), projectHistory(session.history, record.condition), 'none', record.requests, '固定追问', signal);
      record.answer = answer.content;
      return { sessionId, firstRound: session.firstRound, runs: session.runs };
    });
  });
  return router;
}
