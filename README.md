# 请求观察室

用一个问题走完“浏览器 → 本地后端 → 模型服务 → 浏览器”。首页每次独立提问，不保存聊天记录；上下文实验页用于对比同一首轮历史的不同保留范围。

发送后展开“查看这次请求”，可以对照页面实际发送的 JSON、后端阶段、请求编号和累计耗时。缺配置时不会出现“请求模型”与“收到模型回复”。浏览器看到后端的 HTTP 状态；模型服务的状态由后端记录，两者不一定相同。

## 从 GitHub 开始

```powershell
git clone https://github.com/Ador-able/vibe-coding-ai-request-lab.git
cd vibe-coding-ai-request-lab
git switch -c my-lesson-01 vcm-01-01-end
```

按课程指定的标签建立练习分支，避免把持续更新的 `main` 当成固定教材版本。

## 从离线课程包开始

下载包中的 `ai-request-lab.bundle` 包含完整 Git 存档。在解压目录执行：

```powershell
git clone .\ai-request-lab.bundle ..\ai-request-lab-practice
cd ..\ai-request-lab-practice
```

若已在 Git 克隆目录中，可直接运行。旁边的源码用于查看；只有通过 Git 克隆的目录才能切换课程标签。

## 运行

使用 Node.js 24.12.0、pnpm 11.20.0。在项目目录执行：

```powershell
pnpm install --frozen-lockfile
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
pnpm dev
```

打开 `http://127.0.0.1:4318`。在 `.env` 填写 `API_BASE_URL`、`MODEL`、`API_KEY` 后重启服务。Base URL 从百炼模型 API 控制台复制，同地域、同业务空间的密钥配套使用；不含末尾 `/chat/completions`。本项目使用模型 API，不使用 Coding Plan 的专用端点。型号选择支持非思考文本问答的 Qwen 型号，例如 `qwen-flash` 或 `qwen-plus`。缺配置时会显示错误，不会生成演示答案。

`.env` 仅由后端读取，不加 `VITE_` 前缀、不提交到 Git，也不放进网页。一次调用可能产生模型费用。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 收集问题、请求后端、显示回答 |
| `src/server.ts` | 校验问题、读取配置、组织返回结果 |
| `src/model.ts` | 带密钥请求模型服务、读取完整文本 |
| `src/contract.ts` | 约定前后端之间的数据形状 |

## 检查

```powershell
pnpm check
pnpm test
pnpm build
pnpm start
```

测试会启动本地 HTTP 测试桩，不调用真实模型。真实模型是否可用，须填入自己的配置后从页面发送问题确认。

## 课程存档

开始练习前，从指定标签新建自己的分支：

```powershell
git switch -c my-lesson-01 vcm-01-01-end
```

`vcm-01-01-start` 是可运行的问答模板，`vcm-01-01-end` 包含本节请求观察面板。第一节直接使用 `end` 版本观察请求，`start` 用于比较。

| 课程 | 起点 | 完成点 |
| --- | --- | --- |
| 看懂 AI 应用的请求与结果 | `vcm-01-01-start` · `39b4a51497c4` | `vcm-01-01-end` · `020e4fd763dc` |

需要重来时，先在自己的分支提交实验，再从课程存档新开分支：

```powershell
git add .
git commit -m "保存我的实验"
git switch -c my-lesson-01-retry vcm-01-01-start
```

原分支及实验提交仍然保留。Git 只恢复仓库文件，不恢复 `.env`、依赖、模型费用或外部服务状态。

接口依据：[百炼兼容 Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。

## 一次请求里实际装了什么

入口：`http://127.0.0.1:4318/context.html`。沿用上方 Node、pnpm 和模型 API 配置，使用支持 Function Calling 的非思考文本模型，例如 `qwen-flash`。

1. 点击“查询发布时间”。模型先请求 `get_release_info`，本机函数返回一份虚构版本记录，模型再回答发布时间。首轮共两次模型请求。
2. 分别选择“仅本轮问题”“保留聊天文字”“保留完整历史”，发送同一句负责人追问。所有条件使用同一份首轮历史，每次追问只调用模型一次。
3. 展开记录，比较消息、工具定义、工具调用及结果。检查器来自实际发送的请求体；下载的 JSON 保留其原始字符串及实际返回的 `usage`、`finish_reason` 和消息。

三种追问的系统规则、工具定义和参数相同，只改变历史消息。`tool_choice: none` 禁止重新查询；追问结果不会追加到首轮历史。温度固定为 0，不能据此保证模型回答完全一致。若模型猜测、答错或首轮没有遵守“只回答时间”，页面会保留原文，需结合请求记录判断对照是否成立。

工具调用以实际返回的 `tool_calls` 为准；首轮工具阶段接受 `stop` 或 `tool_calls` 结束标记，同时要求一个完整的有效调用。长度截断等未完成结果不会执行工具，原始结束标记仍保存在记录中。

版本资料是本地合成数据，模型返回来自实际 API。本实验不提供模拟成功回退，也不代表模型具有跨请求的长期记忆。历史由本机服务内存持有，浏览器不能回传改写；刷新页面需重新建立首轮，关闭服务后历史清空。每轮最多等待 90 秒，失败会留下已有请求和工具记录；页面不显示请求头、密钥、服务地址或上游原始错误。

| 文件 | 职责 |
| --- | --- |
| `src/context/main.ts` | 切换条件、比较真实回答、查看及下载请求记录 |
| `src/context/routes.ts` | 保存首轮会话、执行工具、发起独立追问 |
| `src/context/scenario.ts` | 虚构版本资料、工具定义、三种历史投影 |
| `src/context/model.ts` | 序列化并记录同一个请求体，调用模型 API |

本课起点为 `vcm-03-01-start`（`81a685749108`），完成点为 `vcm-03-01-end`。从完成点进入可运行的实验：

```powershell
git switch -c my-context-lab vcm-03-01-end
pnpm install --frozen-lockfile
pnpm dev
```

需要恢复时，先在自己的分支提交实验，再从完成点新建分支；起点只包含原问答页。Git 不恢复密钥、费用、服务内存或外部状态。

```powershell
git add .
git commit -m "保存我的上下文实验"
git switch -c my-context-lab-retry vcm-03-01-end
```

定向检查：`pnpm exec tsx --test test/context.test.ts`。测试桩验证协议和历史投影，不是实际模型输出。工具调用协议依据：[百炼 Function Calling](https://help.aliyun.com/zh/model-studio/qwen-function-calling)。
