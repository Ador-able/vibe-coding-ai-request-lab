import { execFileSync } from 'node:child_process';

// 课堂记录对应当前克隆仓库的实际提交。
export function codeVersion(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
}
