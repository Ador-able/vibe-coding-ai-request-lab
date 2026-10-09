import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';

const [project, entry, ...args] = process.argv.slice(2);
if (!project || !entry) {
  console.error('用法：node scripts/run-lab.mjs <实验目录> <Node.js入口> [参数...]');
  process.exit(1);
}
let settings;
try {
  settings = JSON.parse(readFileSync(join(homedir(), '.vibe-coding-labs', 'model.json'), 'utf8'));
  if (!settings.baseUrl || !settings.apiKey || !settings.model) throw new Error();
} catch {
  console.error('请先启动请求观察室，在 http://127.0.0.1:4318 的“模型设置”中保存配置。');
  process.exit(1);
}
const cwd = resolve(project);
// 直接启动 Node.js，参数保持原样，不经由 shell 拼接。
const child = spawn(process.execPath, [...(extname(entry) === '.ts' ? ['--import', 'tsx'] : []), resolve(cwd, entry), ...args], {
  cwd, stdio: 'inherit', env: { ...process.env, API_BASE_URL: settings.baseUrl, API_KEY: settings.apiKey, MODEL: settings.model },
});
child.on('error', () => { console.error('实验启动失败，请核对目录和入口文件。'); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
