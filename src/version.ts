import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 交付包带固定源码标识，运行时不依赖 Git。
export function codeVersion(): string {
  return JSON.parse(readFileSync(resolve('source-version.json'), 'utf8')).sourceVersion;
}
