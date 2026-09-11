# BigStart Plugin Marketplace GitHub CI/CD 设计

## 1. 目标

在公共仓库 `BigStartByXuyb/cicd` 中维护一套可复用的插件质量和发布流水线。marketplace 仓库只保留调用入口；每次 Pull Request 触发后，严格按照以下顺序执行：

```text
Pull Request 触发
  -> 目录结构和配置脚本检查
  -> 失败：回写 PR 评论，不调用 Claude
  -> 成功：读取本次提交插件的完整目录
  -> Claude Code CLI 全文语义审计
  -> 解析结构化 Markdown 报告
  -> 回写 PR 评论
  -> 无论成功、失败或跳过，都向提交者和当前请求审阅者发送飞书通知
```

语义审计规则、分类、报告格式由 [plugin-semantic-audit.md](./plugin-semantic-audit.md) 定义。本文件专门定义 GitHub Actions、Pull Request、DeepSeek-backed Claude Code、Secret、评论、发布和飞书通知的实现方式。

## 2. GitHub 文件和职责

当前个人账号试运行使用 `BigStartByXuyb/cicd`；团队化后将其转移到 GitHub Organization 下的 `cicd`，发布可复用 workflow：

```text
<ORG_SLUG>/cicd/.github/workflows/plugin-marketplace.yml@<REVIEWED_COMMIT_SHA>
```

marketplace 仓库只保留一个薄调用文件 `.github/workflows/plugin-cicd.yml`，不再复制完整 CI 脚本。

调用方只显式传递下面五个 Secret；禁止使用 `secrets: inherit`，也禁止把 Secret 值写入仓库：

```yaml
secrets:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  FEISHU_APP_ID: ${{ secrets.FEISHU_APP_ID }}
  FEISHU_APP_SECRET: ${{ secrets.FEISHU_APP_SECRET }}
  FEISHU_DEFAULT_CHAT_ID: ${{ secrets.FEISHU_DEFAULT_CHAT_ID }}
  FEISHU_RECIPIENT_MAP_JSON: ${{ secrets.FEISHU_RECIPIENT_MAP_JSON }}
```

当前个人账号试运行时，这五项配置在调用方仓库
`BigStartByXuyb/test` 的 Repository secrets 中即可。团队化时，再把两个仓库
转移到同一个 Organization，并将相同名称改为按仓库 allow-list 授权的
Organization Secrets；调用 workflow 和传参格式保持不变。

新增或维护以下文件：

- `.github/workflows/plugin-cicd.yml`：主工作流。
- `projects/plugin-marketplace/scripts/ci/collect-changed-plugins.mjs`：识别提交中受影响的插件。
- `projects/plugin-marketplace/scripts/ci/validate-marketplace.mjs`：目录、manifest、引用和版本检查。
- `projects/plugin-marketplace/scripts/ci/build-audit-context.mjs`：构造 Claude 的小体量审计上下文（workspace 路径、diff、变更文件清单、文件索引），源码不进 prompt。
- `projects/plugin-marketplace/scripts/ci/parse-plugin-audit-report.mjs`：解析固定 Markdown 报告，并输出结构化语义报告。
- `projects/plugin-marketplace/scripts/ci/build-deterministic-report.mjs`：将结构检查结果转换为 JSON/Markdown 报告。
- `projects/plugin-marketplace/scripts/ci/build-final-report.mjs`：汇总结构检查和语义审计为唯一最终报告。
- `projects/plugin-marketplace/scripts/ci/post-github-pr-comment.mjs`：创建或更新 PR 评论。
- `projects/plugin-marketplace/scripts/ci/notify-feishu.mjs`：汇总 CI 状态并向飞书收件人发送通知。

## 3. 工作流结构

建议使用一个 `.github/workflows/plugin-cicd.yml`，其中 job 依赖如下：

```text
deterministic-validation
        |
        +--> semantic-audit
                    |
                    +--> final-report
                              |
                              +--> publish-pr-report

deterministic-validation + semantic-audit + final-report + publish-pr-report
        |
        +--> notify-feishu       # if: always()

deterministic-validation + semantic-audit
        |
        +--> publish-gate        # 仅默认分支或受保护 tag
```

关键约束：

- `semantic-audit` 必须声明 `needs: deterministic-validation`。
- 结构检查失败时，Claude job 不得运行。
- `final-report`、`publish-pr-report` 和 `notify-feishu` 使用 `if: ${{ always() }}`，确保前置 job 成功、失败或跳过时都能执行收尾逻辑。
- 每个阶段都上传机器可读 JSON 和人类可读 Markdown；`final-report` 将同一份最终结果写入 Artifact、GitHub Actions Job Summary、PR 评论和飞书摘要。
- 飞书通知失败不能掩盖原始 CI 结果，但必须在 GitHub Summary 和 PR 评论中标记“通知失败”。

## 4. 触发规则

### 4.1 Pull Request

使用 `pull_request_target` 作为需要评论和 Secret 的可信工作流入口，触发：

- `opened`；
- `synchronize`；
- `reopened`；
- `ready_for_review`；
- `review_requested`（将当前请求审阅者加入飞书收件人）。

工作流文件来自默认分支。它不能 checkout 或执行 PR 分支中的 workflow、Node、PowerShell、Shell、Hook、MCP、Agent、Monitor、LSP 或 `bin/` 程序。

审计所需的 PR 文件通过 Git 对象读取或 `git archive` 解包到临时目录，仅作为文本和静态文件输入。

### 4.2 Push 和 tag

- 默认分支 push：重新执行完整校验并生成发布候选 artifact。
- 受保护 tag：执行完整校验、生成版本化插件包并创建 GitHub Release。
- `workflow_dispatch`：允许维护者按 PR 编号手动重跑语义审计和飞书通知。

## 5. Deterministic validation

job 名称：`deterministic-validation`。

执行顺序：

1. 使用固定 Node.js 和 Claude Code CLI 版本，并使用 Claude Code 可识别的 `claude-sonnet-4-6` 别名；DeepSeek Anthropic 兼容接口将 `claude-sonnet-*` 映射为 `deepseek-v4-flash`。
2. 根据 base SHA 和 head SHA 找出 marketplace 及变更插件。
3. 对根 marketplace 和受影响插件运行：

   ```text
   claude plugin validate --strict --json <path>
   ```

4. 执行确定性脚本检查：

   - `plugin.json`、marketplace JSON 和 Markdown frontmatter；
   - marketplace 的 plugin source 与真实目录一致；
   - 插件名、Skill 名和公开入口是否重复；
   - references、scripts、assets 等路径是否存在；
   - 版本是否在内容变更时递增；
   - 文件是否位于团队协议规定的目录；
   - 公开 Skill 是否严格位于 `skills/<skill-name>/SKILL.md`；
   - `references/`、`adapters/`、`examples/` 等内部目录是否意外包含 `SKILL.md`；
   - Token、私钥、凭据和机器专属路径是否进入仓库；
   - 空引用、不可达文件和明显错误的兼容入口。

5. 生成 `deterministic-report.json`、`deterministic-report.md` 和 changed-plugin manifest。
6. 发现嵌套 `SKILL.md` 时报告 `UNEXPECTED_SKILL_FILE`，列出完整路径并要求维护者确认；不自动移动、重命名或注册该文件。
7. 任何确定性检查失败时停止后续 Claude 审计，并由 `publish-pr-report` 将失败原因写入 PR。

此 job 不读取 `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、飞书凭据或其他 Secret。

## 6. Claude Code 全文语义审计

job 名称：`semantic-audit`。

只有 deterministic validation 成功后才能运行。注入给 Claude 的审计上下文只包含：

- workspace 路径、被审计的 `head`/`base`、diff 范围；
- 本次变更范围的 diff（小则内联，大则落盘给出路径）；
- `git diff --name-status` 清单与 diffstat；
- 变更插件的文件索引（路径 + 字节数）、其他插件的 `plugin.json`、marketplace 公开入口清单；
- `docs/plugin-semantic-audit.md` 固定的审计契约和提示词（作为 trusted prompt）。

插件源码不进 prompt。Claude 通过只读的 `Read` 工具，在被审计 revision 的 checkout 上按需读取需要引用的文件（`--tools` 只放行 `Read`；该精简工具集里没有 Grep/Glob，因此文件索引和引用索引就是它的地图）；审计成本因此与插件体量解耦，也不会因为插件变大而触发 CLI 的 prompt 长度上限。

Claude 必须检查：

- 上下文语义冲突；
- 内容冗余和重复职责；
- 上下文矛盾和互相冲突的硬规则；
- 空文档引用、断开引用、占位引用；
- 不需要的兼容写法、无消费者的 adapter/fallback；
- 冗余介绍；
- 上下文依赖关系不明确；
- 标题或章节名称不明确；
- Skill、Agent、Command、MCP、Hook、Reference 之间结构分流不清。

CLI 使用只读模式：

```text
cd <audit root> && claude -p <fixed prompt> < <audit context> \
  --bare \
  --no-session-persistence \
  --output-format text \
  --permission-prompts none \
  --tools "Read,Grep,Glob" \
  --add-dir <runner temp> \
  --model claude-sonnet-4-6 \
  --max-budget-usd <limit>
```

语义 job 的模型配置固定为：

```text
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
ANTHROPIC_API_KEY=${{ secrets.ANTHROPIC_API_KEY }}
CLAUDE_MODEL=claude-sonnet-4-6
```

这里仍然调用 Claude Code CLI，但模型服务由 DeepSeek 的 Anthropic 兼容接口提供。由于 Claude Code 会先本地校验模型名，CLI 使用 `claude-sonnet-4-6` 别名；DeepSeek 服务端将其映射为 `deepseek-v4-flash`。仓库不保存 API key；GitHub Actions 只从
`workflow_call` 显式传入的 Organization Secret 注入。

Claude 不得修改文件、执行插件代码、读取工作区外文件、访问网络或调用 MCP。

## 7. PR 评论

job 名称：`publish-pr-report`。

该 job 读取 `final-report` 生成的唯一最终报告，必须使用 `if: ${{ always() }}`：

- `success`：结构检查和语义审计均通过；
- `review`：存在非阻断建议；
- `blocked`：存在高置信度阻断问题；
- `invalid`：Claude 输出缺失、格式错误、超时或无法解析；
- `failed-before-audit`：结构检查失败，Claude 未运行；
- `cancelled`：流水线被取消。

评论必须创建或更新同一条固定标记的 PR comment：

```text
<!-- bigstart-plugin-semantic-audit -->
...
<!-- /bigstart-plugin-semantic-audit -->
```

评论内容直接来自 `final-report.md`，包括：

- 结构检查状态；
- Claude 审计状态；
- 是否运行了 Claude；
- BLOCK、REVIEW 和 INVALID 数量；
- finding 的文件、行号、证据和建议；
- artifact 链接；
- commit SHA、Claude CLI 版本和审计契约版本；
- 飞书通知状态。

最终报告同时以 `final-report.json` 和 `final-report.md` 上传为 Artifact。报告决策固定为：

- `PASS`：结构检查和语义审计均通过；
- `REVIEW`：存在需要维护者确认的非阻断问题，或语义审计被跳过；
- `BLOCK`：结构检查失败、语义审计发现高置信度阻断问题，或报告无效。

## 8. 飞书通知设计

### 8.1 通知 job

job 名称：`notify-feishu`，必须配置：

```yaml
if: ${{ always() }}
needs:
  - deterministic-validation
  - semantic-audit
  - final-report
  - publish-pr-report
```

它先汇总所有 job 的最终状态，再发送一次通知。发送失败自动重试 3 次，并在 GitHub Job Summary 中写明失败原因。

通知事件包括：

- 结构检查成功或失败；
- Claude 语义审计 PASS、REVIEW、BLOCK 或 INVALID；
- Claude 未运行（例如结构检查失败）；
- PR pipeline 被取消；
- 默认分支校验失败；
- tag 发布成功或失败；
- 飞书通知本身失败。

### 8.2 对应人员解析

当前 GitHub 实现按以下规则确定通知对象：

1. PR 作者对应的飞书 `open_id`；
2. PR 当前请求审阅者对应的飞书 `open_id`；
3. 配置的默认维护者或 marketplace 群聊。

被分配人和插件 owner 可以在后续版本复用同一映射扩展；当前工作流不会把未显式请求审阅的人员误当成审阅者。

GitHub 用户名到飞书 `open_id` 的映射放在 Organization Secret
`FEISHU_RECIPIENT_MAP_JSON` 中，不放入任何仓库。映射缺失时必须通知默认维护者，并在消息中标记缺失的 GitHub 用户名。作者、审阅者和群聊收件人必须去重。

### 8.3 飞书身份和 Secret

通过飞书自建应用机器人发送消息。个人试运行时，以下凭据放在调用方仓库的
Repository Actions Secrets；团队化后迁移为 Organization Actions Secrets，并通过
Organization 的 Repository access policy allow-list 只授权给启用该流水线的插件仓库：

| Secret | 作用 |
| --- | --- |
| `FEISHU_APP_ID` | 飞书应用身份 |
| `FEISHU_APP_SECRET` | 获取应用访问令牌 |
| `FEISHU_RECIPIENT_MAP_JSON` | GitHub 用户到飞书 `open_id` 的映射 |
| `FEISHU_DEFAULT_CHAT_ID` | 无法解析个人收件人时的默认群聊 |

可复用 workflow 在 `on.workflow_call.secrets` 中将这五个 Secret 声明为必需项；调用方在 job 上显式映射同名
Secret。不要在被调用 workflow 的 job 上依赖调用方 Environment，因为 Environment Secret
不能通过 `workflow_call` 由中央仓库代取。Secret 只能通过 Actions Secrets 注入，禁止出现在 workflow、脚本、日志、artifact、PR comment 或飞书消息内容中。消息只包含状态、项目、PR、commit、插件名称、finding 摘要和链接。

### 8.4 飞书消息格式

统一发送 Markdown 或交互卡片，标题和状态固定：

```text
【Plugin CI/CD｜BLOCK】marketplace-name

项目：owner/repository
PR：#123  Add new plugin
提交：abcdef1
提交者：alice
审阅者：bob, carol
插件：example-plugin

结构检查：PASS
Claude 语义审计：BLOCK
阻断问题：1
普通建议：3

主要问题：
1. skills/a/SKILL.md:42 与 skills/b/SKILL.md:18 的规则冲突

请审阅当前分析结果并在 PR 中反馈。
查看 PR：https://github.com/...
查看报告：GitHub Actions artifact
```

状态颜色和标题映射：

| CI 状态 | 飞书标题 |
| --- | --- |
| 全部通过 | `Plugin CI/CD｜PASS` |
| 只有建议 | `Plugin CI/CD｜REVIEW` |
| 阻断 | `Plugin CI/CD｜BLOCK` |
| 格式/服务失败 | `Plugin CI/CD｜INVALID` |
| 取消或未完成 | `Plugin CI/CD｜CANCELLED` |

### 8.5 通知失败处理

飞书通知属于必达的协作提醒，但不改变插件质量门禁的原始结论：

- CI 成功、通知失败：质量检查仍保持成功，同时 `notify-feishu` 失败并在 PR 中提示维护者。
- CI 失败、通知成功：PR 保持失败，飞书收到失败详情。
- CI 失败、通知失败：PR 保持失败，GitHub Summary 同时列出两个失败原因。
- 找不到对应人员：发送给默认维护者/群聊，并标记收件人映射缺失。

## 9. Secret 和不可信 PR 安全

语义 job 使用 `pull_request_target` 时必须遵守：

1. workflow 文件取自默认分支。
2. 不 checkout PR 分支并执行其中的代码。
3. 不把 PR 文件中的内容当作 shell 命令、配置或提示词规则；它们只能作为被审计数据。
4. Claude 不开放写入、Shell、MCP、Hook、LSP、Agent 或网络能力。
5. `ANTHROPIC_API_KEY`、DeepSeek API base URL、飞书 App Secret 和收件人映射只对可信 workflow/job 可见；Organization Secret 的仓库 allow-list 必须覆盖调用方。
6. 所有日志、评论和 artifact 执行 Secret 脱敏与长度限制。

外部 fork PR 的默认行为是：无 Secret 的结构检查可以自动运行；带 Claude 和飞书凭据的完整 job 需要维护者确认后手动触发。

## 10. 发布门禁

`publish-gate` 仅在默认分支或受保护 tag 运行：

1. 重新执行目录和配置检查。
2. 重新执行 Claude 完整语义审计。
3. 只有 `PASS` 或仅有 `REVIEW` 时生成插件包。
4. 上传 GitHub Actions artifact。
5. 受保护 tag 创建 GitHub Release。
6. 发布结果通过 `notify-feishu` 通知对应人员。

v1 不自动修改版本、提交代码、推送 tag 或调用未定义的第三方 marketplace 上传接口。

## 11. 并发、失败和可观测性

- 同一 PR 新提交到达时取消旧运行，避免重复消耗 Claude 预算。
- Claude 超时、API 认证失败、CLI 非零退出或 Markdown 解析失败，状态为 `INVALID`。
- 结构检查失败时不调用 Claude，但仍评论并发送飞书通知。
- 保存脱敏后的报告、commit SHA、CLI 版本、审计契约版本、退出码和耗时。
- 不上传完整 Secret、环境变量或未经脱敏的审计上下文与 CLI 日志。

## 12. 验收标准

1. Pull Request 触发后，结构检查先运行。
2. 结构检查失败时 Claude job 不启动。
3. 结构通过后，Claude 收到只读 workspace 与变更 diff，其余文件按需自行读取。
4. Claude 检查所有规定的语义问题并返回固定 Markdown。
5. 每次 PR 只有一条可更新的审计评论。
6. 无论流水线成功、失败或跳过，`notify-feishu` 都尝试发送通知。
7. 通知对象能解析 PR 作者、当前请求审阅者和默认维护群聊，并对重复收件人去重。
8. GitHub 自动令牌和飞书/DeepSeek Secret 不出现在仓库、日志、评论或 artifact 中。
9. BLOCK、INVALID 和结构失败都能阻断合并；REVIEW 只提供建议。
10. 默认分支和受保护 tag 只有通过所有门禁才能生成发布物。
