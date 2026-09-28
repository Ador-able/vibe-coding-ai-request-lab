import { Router } from 'express';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ModelError, readConfig } from '../model.ts';
import { SOURCE_MAP, SOURCES, QUESTION, TEACHING_NOTE } from './materials.ts';
import { createNoteStore } from './note-store.ts';
import { FLOWS, type Flow, type FlowResponse, type FlowResult } from './contract.ts';
import { runFlow } from './flows.ts';

export function createMemoryRouter(env: NodeJS.ProcessEnv, notePath = resolve('artifacts/memory-task-note.json')) {
  const router = Router();
  const store = createNoteStore(notePath);
  router.get('/materials', (_req, res) => { res.json({ question: QUESTION, sources: SOURCES, teachingNote: TEACHING_NOTE }); });
  router.get('/sources/:id', (req, res) => {
    const source = SOURCE_MAP.get(req.params.id);
    if (!source) { res.status(404).json({ error: '没有这个来源编号。' }); return; }
    res.json(source);
  });
  router.get('/note', async (_req, res) => {
    try { res.json({ saved: await store.load() }); }
    catch { res.status(500).json({ error: '本地便笺无法读取，请核对后重新保存。' }); }
  });
  router.post('/note', async (req, res) => {
    if (req.body?.confirmed !== true) { res.status(400).json({ error: '请先勾选已核对这份人工教学记录。' }); return; }
    try { res.json({ saved: await store.save() }); }
    catch { res.status(500).json({ error: '便笺未能写入本机文件，请检查目录是否可写。' }); }
  });
  router.post('/flow', async (req, res) => {
    const flow = req.body?.flow;
    if (typeof flow !== 'string' || !Object.hasOwn(FLOWS, flow)) { res.status(400).json({ error: '请选择固定实验流程。' }); return; }
    const result: FlowResult = { id: randomUUID(), flow: flow as Flow, startedAt: new Date().toISOString(), requests: [], answer: null };
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      const config = readConfig(env);
      if (config.model !== 'qwen-flash') throw new ModelError('CONFIG_INVALID', '本实验使用 qwen-flash，请核对 MODEL 配置后重启。', 503);
      const saved = flow === 'note' ? await store.load() : undefined;
      // 每次流程独立构造输入，没有跨流程聊天消息；总等待时间涵盖整条流程。
      await runFlow(config, result, AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]), saved ?? undefined);
      if (!res.destroyed) res.json({ ok: true, result } satisfies FlowResponse);
    } catch (error) {
      const failure = error instanceof ModelError ? error : new ModelError('MODEL_NETWORK_ERROR', '本流程未能完成，请检查本机服务与便笺文件。');
      result.error = { code: failure.code, message: failure.message };
      if (!res.destroyed) res.status(failure.httpStatus).json({ ok: false, result } satisfies FlowResponse);
    } finally { res.off('close', cancel); }
  });
  return router;
}
