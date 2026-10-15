# 应用 CI/CD 设计

面向「Node 后端 + React 前端 + 本地工具链」的客户端仓库（调用方：`BigStartByXuyb/mastergo-transcoder-gui`）。可复用工作流：`.github/workflows/desktop-app.yml`。

## 作业划分

| Job | 跑什么 | 为什么单独一个 job |
| --- | --- | --- |
| `deterministic-validation` | `check-app-structure.mjs`（硬编码路径 / 孤儿导出 / 分层），以及「重新构建前端后 `public/` 不许有改动」 | 机械判定，不执行仓库里的任意代码 |
| `runtime-tests` | 后端 `npm test` + `npm run test:coverage`，前端 `ui/` 的 `npm run test:coverage`（阈值各自写在对应 package.json） | 会执行未受信任的 PR 代码，权限收窄到 `contents: read`、不注入任何 secret |
| `semantic-audit` | Claude（DeepSeek 的 Anthropic 兼容端点）按 `docs/app-semantic-audit.md` 审 diff | 只读、只有 `Read`，不执行代码 |
| `final-report` | 汇总前三个 job 的结论 | 任何 job 失败也要出报告，结论如实反映原因 |
| `publish-pr-report` | 把最终报告贴到 PR（有则更新） | 只在 PR 上跑 |
| `notify-feishu` | 飞书通知 | 没配密钥时打印跳过说明并以 0 退出 |

## 门禁清单（每个都能失败，且对应一个真实风险）

| 门禁 | 怎么失败 | 防的是什么 |
| --- | --- | --- |
| 硬编码机器路径 | `lib/**`、`server.js`、`ui/src/**` 里出现 `X:\`、`/Users/`、`/home/`、`file://`（注释行除外） | 换机器跑不了；或者悄悄写到别人机器上的路径 |
| 孤儿导出 | `lib/*.js` 导出的名字在仓库别处没有任何引用（含 `mod.name` 形式） | 死代码堆积：改了没人知道，读代码的人以为它有用 |
| 分层 | `ui/src/**` 引用后端实现或 `server.js`；后端引用 `ui/**` | 前端绕过接口直接碰后端内部，重构时两处一起崩 |
| CI 版本钉死 | 调用方 workflow 的 `uses@<ref>` 不是 40 位 commit SHA，或与 `ci_ref` 入参不一致 | 门禁被上游静默改掉；两处 pin 漂移成「外层一个版本、内层另一个版本」 |
| 构建产物一致 | `npm run build:ui` 之后 `git diff --exit-code public/` 有改动 | 前端源码改了忘了重新构建：仓库里看不出来，用户那儿是旧界面 |
| 单元测试 | `npm test` 任一用例失败 | 行为回归 |
| 覆盖率阈值（后端） | `npm run test:coverage`（阈值写在调用方 `package.json`：`--test-coverage-lines/functions/branches`，只统计 `lib/**`） | 新逻辑没被测到就合进主干 |
| 覆盖率阈值（前端） | `ui/` 里 `npm run test:coverage`（vitest + v8，只统计 `src/lib/**` 与共用展示组件，阈值在 `ui/vitest.config.ts`） | 前端逻辑没被测到就合进主干 |
| 语义审计 | 契约要求 `BLOCK`（有证据的结构性问题）或报告 `INVALID`（不合契约） | 机械检查覆盖不到的语义问题：复杂度、冗余、设计不连贯、不必要的门禁、耦合 |

门禁之间不重复拦同一件事：机械检查只判「可机械判定」的三件事，语义审计明确不重复它们的结论（见契约「目的」一节）。

## 覆盖率口径

- 后端只统计 `lib/**`（`server.js` 与路由是进程装配，靠端到端验证）。
- 前端只统计 `src/lib/**` 与两个共用展示组件：页面级组件是编排与渲染，逻辑按规矩沉到 `src/lib/` 后再把 include 放宽。
- 阈值分别写在调用方仓库的 `package.json` 与 `ui/vitest.config.ts`，不放 CI 脚本：数值与口径必须和被测仓库一起评审、一起改。
- 覆盖率输出（后端 + 前端）合并后作为 artifact 上传，供语义审计参考（不做机械比较）。

## 语义审计边界

- 输入只有审计上下文 + 只读工作区；源码不内联进 prompt，模型按索引自己 `Read`。
- 工具只给 `Read`：不能执行、不能写、不能联网。
- 结论必须带「仓库相对路径 + 行号」证据；证据不足只能报 REVIEW。
- `BLOCK` 只留给三种情况：高置信矛盾、会让功能选错路径的入口/边界歧义、有证据的死代码或永远为真的门禁。

## 加新门禁的规矩

1. 门禁必须能失败，且能说清对应哪个真实风险；说不清就不加。
2. 门禁要么进 `check-app-structure.mjs`（机械类），要么写进审计契约（语义类），不要两处各写一半。
3. 新脚本必须被 workflow 引用，且被 `app-cicd.test.mjs` 覆盖（含「workflow 引用的脚本必须存在」这条断言）。
4. 调用方仓库用 commit SHA 固定 `ci_ref`：CI 逻辑变了要显式改 pin，不让门禁被静默改掉。

## 调用方需要配置的 Secrets

`ANTHROPIC_API_KEY`（语义审计，DeepSeek 的 Anthropic 兼容端点）、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DEFAULT_CHAT_ID`、`FEISHU_RECIPIENT_MAP_JSON`（飞书通知；不配则通知跳过）。
