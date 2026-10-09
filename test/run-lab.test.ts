import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('配置入口在目标目录运行程序，参数与退出码透传且不输出密钥', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vibe-runner-')); const project = join(home, '含空格的 实验');
  const secret = 'only-local-runner-key';
  await mkdir(project); await mkdir(join(home, '.vibe-coding-labs'));
  await writeFile(join(home, '.vibe-coding-labs', 'model.json'), JSON.stringify({ baseUrl: 'https://example.test/v1', apiKey: secret, model: 'test-model' }));
  await writeFile(join(project, 'entry.mjs'), `import assert from 'node:assert/strict';
assert.equal(process.env.API_BASE_URL, 'https://example.test/v1');
assert.equal(process.env.API_KEY, '${secret}');
assert.equal(process.env.MODEL, 'test-model');
assert.equal(process.cwd(), ${JSON.stringify(project)});
assert.deepEqual(process.argv.slice(2), ['含 空格', 'literal;$()']);
console.log('配置已复用'); process.exitCode = 7;`);
  try {
    const child = spawn(process.execPath, [resolve('scripts/run-lab.mjs'), project, 'entry.mjs', '含 空格', 'literal;$()'], {
      env: { ...process.env, USERPROFILE: home, HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = ''; child.stdout.on('data', (part) => { output += part; }); child.stderr.on('data', (part) => { output += part; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 7); assert.equal(output.trim(), '配置已复用'); assert(!output.includes(secret));
  } finally { await rm(home, { recursive: true, force: true }); }
});
