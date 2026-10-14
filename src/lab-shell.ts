import './lab-shell.css';

type Settings = { baseUrl: string; model: string; structuredModel: string; embeddingModel: string; hasKey: boolean };
const experiments = [
  ['/', '独立提问'], ['/context.html', '上下文对照'], ['/quality.html', '材料对照'],
  ['/latency.html', '等待与用量'], ['/memory.html', '按需读取与记忆'],
  ['/structured.html', '结构化输出'], ['/streaming.html', '流式消息'],
  ['/message-history.html', '消息记录'], ['/requests.html', '请求状态'],
  ['/decisions.html', '阅读方案'], ['/collaboration.html', '笔记共写'], ['/feedback.html', '人物指代'],
];
const bar = document.createElement('nav'); bar.className = 'lab-nav'; bar.setAttribute('aria-label', '实验导航');
bar.innerHTML = `<div><label for="lab-page">实验</label><select id="lab-page"></select></div><button id="model-settings-open" type="button">模型设置</button>`;
const dialog = document.createElement('dialog'); dialog.className = 'model-settings';
dialog.setAttribute('aria-labelledby', 'model-settings-title');
dialog.innerHTML = `<form id="model-settings-form"><h2 id="model-settings-title">模型设置</h2>
  <p>本机实验共用，保存后立即生效。</p>
  <label for="model-base-url">OpenAI 兼容接口地址<input id="model-base-url" type="url" required></label>
  <label for="model-api-key">API Key<input id="model-api-key" type="password" autocomplete="off"></label>
  <label for="model-name">模型<input id="model-name" required></label>
  <details><summary>其他实验模型（可选）</summary><label for="structured-model-name">结构化输出模型<input id="structured-model-name" placeholder="留空沿用上面的模型"></label><label for="embedding-model-name">向量模型<input id="embedding-model-name" placeholder="进行向量实验时填写"></label></details>
  <p id="model-settings-status" role="status"></p>
  <div class="model-settings-actions"><button type="button" id="model-settings-close">取消</button><button type="submit" id="model-settings-save">保存</button></div>
</form>`;
document.body.prepend(bar); document.body.append(dialog);
const get = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const navigation = get<HTMLSelectElement>('lab-page');
experiments.forEach(([path, label]) => navigation.add(new Option(label, path)));
navigation.value = location.pathname === '/index.html' ? '/' : location.pathname;
navigation.addEventListener('change', () => { location.href = navigation.value; });
const status = get('model-settings-status');
let current: Settings | undefined;
function display(settings: Settings) {
  current = settings;
  get<HTMLButtonElement>('model-settings-open').textContent = settings.hasKey
    ? '模型设置' : '设置模型';
  get<HTMLInputElement>('model-base-url').value = settings.baseUrl;
  get<HTMLInputElement>('model-name').value = settings.model;
  get<HTMLInputElement>('structured-model-name').value = settings.structuredModel;
  get<HTMLInputElement>('embedding-model-name').value = settings.embeddingModel;
  const key = get<HTMLInputElement>('model-api-key'); key.value = ''; key.required = !settings.hasKey;
  key.placeholder = settings.hasKey ? '••••••••（已保存，留空保留）' : '填写 API Key';
}
get('model-settings-open').addEventListener('click', () => {
  if (current) display(current);
  status.textContent = ''; dialog.showModal();
});
get('model-settings-close').addEventListener('click', () => { get<HTMLInputElement>('model-api-key').value = ''; dialog.close(); });
dialog.addEventListener('cancel', () => { get<HTMLInputElement>('model-api-key').value = ''; });
get<HTMLFormElement>('model-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const save = get<HTMLButtonElement>('model-settings-save'); save.disabled = true; status.textContent = '';
  try {
    const response = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: get<HTMLInputElement>('model-base-url').value,
        apiKey: get<HTMLInputElement>('model-api-key').value, model: get<HTMLInputElement>('model-name').value,
        structuredModel: get<HTMLInputElement>('structured-model-name').value,
        embeddingModel: get<HTMLInputElement>('embedding-model-name').value }) });
    const data = await response.json() as Settings & { error?: string };
    if (!response.ok) throw new Error(data.error || '模型配置没有保存，请重试。');
    display(data); dialog.close();
    // 更新页面上的型号说明，不刷新或丢掉已有实验结果。
    window.dispatchEvent(new Event('model-settings-changed'));
  } catch (error) { status.textContent = error instanceof Error ? error.message : '无法连接本机服务，请确认服务仍在运行。'; }
  finally { save.disabled = false; }
});
void fetch('/api/config').then(async (response) => {
  if (!response.ok) throw new Error();
  const settings = await response.json() as Settings; display(settings);

}).catch(() => { status.textContent = '模型设置不可用，请确认本机服务仍在运行。'; });
