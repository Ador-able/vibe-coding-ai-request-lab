import DOMPurify from 'dompurify';
import { marked } from 'marked';
import './markdown.css';

// 只改变阅读排版，请求记录和下载仍保留模型原文。
export function renderMarkdown(target: HTMLElement, text: string) {
  target.classList.add('markdown');
  target.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }));
}

export function markdown(text: string, className = '') {
  const target = document.createElement('div');
  target.className = className;
  renderMarkdown(target, text);
  return target;
}
