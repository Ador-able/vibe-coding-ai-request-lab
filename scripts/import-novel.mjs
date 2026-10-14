import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const path = process.argv[2];
if (!path) throw new Error('请提供《凡人修仙传》TXT 文件路径。');
const bytes = await readFile(path);
let text, encoding;
for (const candidate of ['utf-8', 'gb18030']) {
  try { text = new TextDecoder(candidate, { fatal: true }).decode(bytes); encoding = candidate; break; }
  catch { /* 尝试原文件的另一种常见编码。 */ }
}
if (!text) throw new Error('文件编码不是 UTF-8 或 GB18030。');
const start = text.search(/^第一章\s+山边小村\s*$/m);
if (start < 0) throw new Error('未找到第一章“山边小村”，请核对原文件。');
const hanCount = value => (value.match(/\p{Script=Han}/gu) ?? []).length;
// 沿原文段落连续取样，不重复、不补写；章节名只用于目录定位。
const paragraphs = text.slice(start).match(/[^\r\n]+(?:\r?\n)*/g) ?? [];
const sources = [];
let position = start, buffer = '', chapter = '第一章 山边小村', firstChapter = chapter;
for (const paragraph of paragraphs) {
  const heading = paragraph.trim();
  if (/^第[零〇一二三四五六七八九十百千\d]+章\s+/.test(heading)) chapter = heading;
  if (!buffer) firstChapter = chapter;
  buffer += paragraph;
  if (hanCount(buffer) < 2000) continue;
  const id = `C${String(sources.length + 1).padStart(2, '0')}`;
  sources.push({ id, title: firstChapter === chapter ? firstChapter : `${firstChapter}—${chapter}`,
    text: buffer, hanCount: hanCount(buffer), start: position, end: position + buffer.length });
  position += buffer.length; buffer = '';
  if (sources.length === 30) break;
}
if (sources.length !== 30) throw new Error('原文件不足以连续提取30条、每条至少2000汉字的材料。');
const corpus = { novel: '凡人修仙传', author: '忘语', encoding,
  originalSha256: createHash('sha256').update(bytes).digest('hex'),
  sourceSha256: createHash('sha256').update(sources.map(item => item.text).join('')).digest('hex'), sources };
const directory = resolve('materials/凡人修仙传');
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, '原文片段.json'), JSON.stringify(corpus, null, 2) + '\n');
console.log(`已提取${sources.length}条连续原文，共${sources.reduce((sum, item) => sum + item.hanCount, 0)}汉字；每条${Math.min(...sources.map(item => item.hanCount))}—${Math.max(...sources.map(item => item.hanCount))}汉字。`);
