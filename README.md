# 请求观察室

统一使用读者提供的《凡人修仙传》（作者：忘语）现成原文。共30条连续片段，每条2,000—2,119汉字，总计60,910汉字，不扩写或填充。出处、原文件哈希和原文位置见 [材料来源](materials/凡人修仙传/来源说明.md)。

## 首次准备

沿用课程首次准备的 Node.js 24.12 或更高的 24 版本与 pnpm。只需克隆、安装一次：

```powershell
git clone https://github.com/Ador-able/vibe-coding-ai-request-lab.git
cd vibe-coding-ai-request-lab
pnpm install --frozen-lockfile
```

双击“启动实验.cmd”，打开 [请求观察室](http://127.0.0.1:4318)。也可运行 pnpm dev。保持启动窗口打开，结束时按 Ctrl+C；后续章节沿用这个目录，用顶部“实验”切换页面。

在“模型设置”填写 OpenAI 兼容接口地址、API Key 和自选模型，所有页面共用已保存设置。Base URL 不含末尾的 /chat/completions。配置保存在本机用户目录的 .vibe-coding-labs/model.json；已有密钥显示为掩码，留空保存会保留原值。

消息保存与转换、请求状态演练使用明确标注的原文回显，不调用云模型。其他生成操作请求真实模型；长材料请求每次读约六万汉字，实际用量以返回记录为准。

## 实验入口

| 实验 | 页面 | 操作 |
| --- | --- | --- |
| 独立提问 | index.html | 输入问题，发送后展开请求记录。 |
| 上下文对照 | context.html | 查第一章韩立的年龄，再追问排行，对照三种历史范围。 |
| 材料对照 | quality.html | 查第一章年龄与排行，对比短原文及长原文的首、中、末位置。 |
| 等待与用量 | latency.html | 比较五种请求条件的等待与实际用量。 |
| 按需读取与记忆 | memory.html | 查大哥的学徒月钱，对照全文、选读、现场300字阅读摘要，再保存并读回核对后的信息。 |
| 阅读方案 | decisions.html | 比较事件顺序、人物关系两种阅读笔记方案，选择后编辑。 |
| 笔记共写 | collaboration.html | 按所选方案整理笔记，再依据实际笔记继续反馈。 |
| 人物指代 | feedback.html | 比较规则保存前、启用与停用后的判断。 |
| 结构化输出 | structured.html | 提取C02原文中的待办，核对格式、原文依据和业务保存。 |
| 流式消息 | streaming.html | 观察摘要与问题两阶段的事件、快照和整体结束。 |
| 消息记录 | message-history.html | 保存受控原文回显消息，重新读回，再比较 P0/P1/P2 输入。 |
| 请求状态 | requests.html | 受控演练停止、超时、401、503 和本机断连，按同一编号核查结果。 |

结构化输出需模型支持严格 JSON Schema，上下文实验需支持工具调用。需要不同型号时，在“其他实验模型”中设置一次。

## 材料与课堂实录

当前教学原文统一在 materials/凡人修仙传/原文片段.json。各页面从同一数据源取用，课堂新运行记录放 records/凡人修仙传/。没有记录的页面需现场运行，不展示其他材料的旧回答。

records/青岚修仙录历史材料/ 与原 chapter 目录保留旧实验原始资料，不作为《凡人修仙传》的新结果。消息页的完整和未完成示例来自受控原文回显；请求状态页仍用官方 Mock 与实际 SDK、HTTP 演练。两者均不声称云模型生成。

## 保存与失败处理

按正文下载需要保留的实际运行 JSON。记录保留本次请求正文和回答，不含认证头或密钥。多数页面的尝试在刷新后清空，上下文内存历史在服务重启后清空。确认过的任务摘要在 artifacts/material-summary.json，人物规则在 .local-data/novel-feedback-rule.json，消息数据库在 .data/messages.sqlite。

真实模型实验失败后显示错误并保留已取得的片段，不自动重试。请求状态页的 503 条件用于观察 SDK 的受控重试。写锁期间保存失败，释放锁后再明确保存。停止服务不会恢复正在生成的任务；请求状态页按编号核查只针对当前服务进程。

端口占用时先关闭另一个请求观察室。需要独立端口时，在 PowerShell 设置 $env:LAB_PORT='4349'，再运行 .\启动实验.cmd。

<details>
<summary>修改源码与独立检查</summary>

源码在 src/，运行入口在 scripts/，锁文件固定依赖。按改动运行 pnpm check 与对应测试；需要构建后运行时执行 pnpm build、pnpm start。构建产物和个人运行数据不提交 Git。

独立读回消息：

```powershell
node scripts/messages-inspect.mjs --db .data/messages.sqlite --conversation <会话ID> --out 独立读回.json
```

其他 OpenAI 兼容接口实验可通过已有模型配置入口运行：

```powershell
node scripts/run-lab.mjs "D:/练习/动作审批" dist/approval-cli.js
```

目标项目按自身 README 完成准备，当前入口复用已保存的模型设置。source-version.json 保留课堂程序的源码标识；实际新运行结果以本次完整记录为准。

</details>
