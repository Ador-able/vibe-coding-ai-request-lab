import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express from 'express';
import { createApp } from '../src/server.ts';
import { createMessageHistoryRouter } from '../src/message-history/routes.ts';
import { createRequestsRouter } from '../src/requests/routes.ts';
import { codeVersion } from '../src/version.ts';

// 课堂证据使用独立数据目录，模型设置仍复用既有只读配置。
const dataDirectory = resolve('.data/凡人输出课堂-20261015');
const app = createApp(undefined, () => {});
const messages = await createMessageHistoryRouter(dataDirectory);
const requests = await createRequestsRouter(resolve(dataDirectory, 'requests'));
app.use('/api/messages', messages.router);
app.use('/api/requests', requests.router);
app.use(express.static(resolve('dist/client')));
const server = createServer(app);
const port = Number(process.env.LAB_PORT || 4359);
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({
  url: `http://127.0.0.1:${port}`, sourceVersion: codeVersion(), dataDirectory,
})));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  requests.close(); server.closeAllConnections(); server.close(() => { messages.close(); process.exit(0); });
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; messages.close(); requests.close(); });
