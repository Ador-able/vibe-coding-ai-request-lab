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
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: '请用简洁的中文回答问题。' },
          { role: 'user', content: question },
        ],
        stream: false,
        enable_thinking: false,
        max_tokens: 1024,
      }),
      signal,
    });
  } catch {
    if (signal.aborted) {
      const timedOut = signal.reason?.name === 'TimeoutError';
      throw new ModelError(timedOut ? 'MODEL_TIMEOUT' : 'REQUEST_CANCELLED', timedOut ? '等待模型超过 60 秒，请稍后重试。' : '本次请求已取消。', 504);
    }
    throw new ModelError('MODEL_NETWORK_ERROR', '未能连接模型服务。请检查网络和 API_BASE_URL。');
  }

  if (!response.ok) {
    await response.body?.cancel();
    // 不把服务商原始错误正文回传，以免带出密钥或账户信息。
    const action = response.status === 401 || response.status === 403
      ? '请检查密钥、地域与模型访问权限。'
      : response.status === 429 ? '请稍后重试，或检查额度与请求频率。' : '请检查型号及服务状态。';
    throw new ModelError('MODEL_HTTP_ERROR', `模型服务返回 HTTP ${response.status}。${action}`, 502, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (signal.aborted) {
      throw new ModelError('MODEL_TIMEOUT', '读取模型回复超时，请稍后重试。', 504, response.status);
    }
    throw new ModelError('MODEL_RESPONSE_INVALID', '模型服务没有返回可读取的 JSON。', 502, response.status);
  }

  // 模型接口是外部边界，只接收本节需要的完整文本结果。
  const choice = (payload as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] } | null)?.choices?.[0];
  if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim()) {
    throw new ModelError('MODEL_RESPONSE_INVALID', '模型回复中没有可显示的文本。请检查所选型号是否支持非思考文本问答。', 502, response.status);
  }
  if (choice.finish_reason !== 'stop') {
    throw new ModelError('MODEL_RESPONSE_INCOMPLETE', '模型没有完整结束回答，请缩短问题后重试。', 502, response.status);
  }
  return { answer: choice.message.content, httpStatus: response.status };
}
