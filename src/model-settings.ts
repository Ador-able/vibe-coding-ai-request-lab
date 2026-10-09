import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { ModelError, readConfig } from './model.ts';

export const MODEL_SETTINGS_PATH = join(homedir(), '.vibe-coding-labs', 'model.json');
const settingsSchema = z.object({
  baseUrl: z.string().trim().min(1), model: z.string().trim().min(1),
  apiKey: z.string().trim(), structuredModel: z.string().trim().default(''),
  embeddingModel: z.string().trim().default(''),
});
type Settings = z.infer<typeof settingsSchema>;
const defaults: Settings = {
  baseUrl: '', model: '', apiKey: '', structuredModel: '', embeddingModel: '',
};

export function createModelSettings(path = MODEL_SETTINGS_PATH) {
  let settings = { ...defaults };
  try { settings = settingsSchema.parse({ ...defaults, ...JSON.parse(readFileSync(path, 'utf8')) }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const env: NodeJS.ProcessEnv = {};
  function apply() {
    Object.assign(env, { API_BASE_URL: settings.baseUrl, MODEL: settings.model,
      API_KEY: settings.apiKey, STRUCTURED_MODEL: settings.structuredModel, EMBEDDING_MODEL: settings.embeddingModel });
  }
  apply();
  // 页面只获知密钥是否已保存，明文留在本机配置与模型认证头中。
  const publicSettings = () => ({ baseUrl: settings.baseUrl, model: settings.model,
    structuredModel: settings.structuredModel, embeddingModel: settings.embeddingModel, hasKey: !!settings.apiKey });
  const router = Router();
  router.get('/', (_req, res) => res.json(publicSettings()));
  router.put('/', (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: '请填写模型地址、型号和密钥。' }); return; }
    const next = { ...parsed.data, apiKey: parsed.data.apiKey || settings.apiKey };
    try { readConfig({ API_BASE_URL: next.baseUrl, MODEL: next.model, API_KEY: next.apiKey }); }
    catch (error) {
      res.status(400).json({ error: error instanceof ModelError ? error.message : '模型配置不正确。' }); return;
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(next, null, 2) + '\n', 'utf8');
      renameSync(`${path}.tmp`, path);
      settings = next; apply();
      res.json(publicSettings());
    } catch { res.status(500).json({ error: '无法保存本机配置，请检查文件写入权限。' }); }
  });
  return { env, router };
}
