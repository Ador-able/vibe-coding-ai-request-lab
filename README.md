# 请求观察室

用一个问题走完“浏览器 → 本地后端 → 模型服务 → 浏览器”。每次独立提问，不保存聊天记录。

## 从课程包创建练习目录

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
Copy-Item .env.example .env
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

需要重来时，先在自己的分支提交实验，再从课程存档新开分支：

```powershell
git add .
git commit -m "保存我的实验"
git switch -c my-lesson-01-retry vcm-01-01-start
```

原分支及实验提交仍然保留。Git 只恢复仓库文件，不恢复 `.env`、依赖、模型费用或外部服务状态。

接口依据：[百炼兼容 Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)。
