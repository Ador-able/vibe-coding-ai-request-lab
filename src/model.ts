import { APICallError, generateText } from 'ai';
import { createBailian } from './ai-provider.ts';
import type { ErrorCode } from './contract.ts';

export type ModelConfig = { baseUrl: string; model: string; apiKey: string };

export class ModelError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public httpStatus = 502,
    public modelHttpStatus?: number,
  ) {
    super(message);
  }
}

export function readConfig(env: NodeJS.ProcessEnv): ModelConfig {
  const missing = ['API_BASE_URL', 'MODEL', 'API_KEY'].filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new ModelError('CONFIG_MISSING', `尚未配置 ${missing.join('、')}。请在项目 .env 中填写后重启服务。`, 503);
  }
  const baseUrl = env.API_BASE_URL!.trim().replace(/\/+$/, '');
  try {
    const url = new URL(baseUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) {
      throw new Error();
    }
  } catch {
    throw new ModelError('CONFIG_INVALID', 'API_BASE_URL 格式不正确，请复制控制台提供的完整 Base URL。', 503);
  }
  return { baseUrl, model: env.MODEL!.trim(), apiKey: env.API_KEY!.trim() };
}

export async function askModel(question: string, config: ModelConfig, signal: AbortSignal) {
  let httpStatus: number | undefined;
  const provider = createBailian(config, async (url, init) => {
    const response = await fetch(url, init); httpStatus = response.status; return response;
  });
  try {
    const result = await generateText({
      model: provider.chatModel(config.model), instructions: '请用简洁的中文回答问题。', prompt: question,
      providerOptions: { bailian: { enable_thinking: false, stream: false } },
      maxOutputTokens: 1024, maxRetries: 0, abortSignal: signal,
    });
    if (result.rawFinishReason !== 'stop') throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '模型没有完整结束回答，请缩短问题后重试。', 502, httpStatus);
    if (!result.text.trim()) throw new ModelError('MODEL_RESPONSE_INVALID', '模型回复中没有可显示的文本。', 502, httpStatus);
    return { answer: result.text, httpStatus: httpStatus! };
  } catch (error) {
    if (error instanceof ModelError) throw error;
    if (signal.aborted) {
      const timedOut = signal.reason?.name === 'TimeoutError';
      throw new ModelError(timedOut ? 'MODEL_TIMEOUT' : 'REQUEST_CANCELLED', timedOut ? '等待模型超过60秒，请稍后重试。' : '本次请求已取消。', 504);
    }
    if (APICallError.isInstance(error) && error.statusCode) {
      throw new ModelError('MODEL_HTTP_ERROR', `模型服务返回 HTTP ${error.statusCode}。请检查权限、额度和服务状态。`, 502, error.statusCode);
    }
    throw new ModelError(httpStatus === undefined ? 'MODEL_NETWORK_ERROR' : 'MODEL_RESPONSE_INVALID',
      httpStatus === undefined ? '未能连接模型服务，请检查网络和API_BASE_URL。' : '模型没有返回可处理的完整文字。');
  }
}
