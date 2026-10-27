# Go 服务 CI/CD 设计

面向 Go 服务仓库（调用方：`data_ai/svc_monitor`）的中央下游流水线套件。调用方 `.gitlab-ci.yml` 只做分发，job 全部在 `data_ai/cicd` 运行。

## 作业划分

| Job | 跑什么 | 为什么单独一个 job |
| --- | --- | --- |
| `go:structure` | `check-go-structure.mjs`：仓库契约与分发配置、Go 文件位置、分层依赖方向、写死的机器路径；`internal/webui/assets/` 存在时跑 prettier 检查 | 机械判定，不执行仓库里的任意代码；node 镜像即可 |
| `go:toolchain` | `gofmt -l`、`go vet`、`go mod tidy` 后工作区无 diff、linux/windows 交叉编译 | 需要 Go 工具链，golang 镜像里跑；只编译不测试 |
| `go:runtime-tests` | `go test -race -coverprofile` | 会执行未受信任的 MR 代码：不注入任何 secret |
| `go:coverage-gate` | 解析 coverage profile，卡总覆盖率与单包覆盖率 | 与运行时测试分开：测试失败时门禁仍能给出明确结论 |
| `go:semantic-audit` | Claude（DeepSeek 的 Anthropic 兼容端点）按 `docs/go-semantic-audit.md` 审 diff | 只读、只有 `Read`，不执行代码 |
| `go:final-report` | 合并结构检查、工具链检查、覆盖率与语义审计的结论 | 任何 job 失败也要出报告，结论如实反映原因 |
| `go:mr-note` | 把最终报告贴到 MR（有则更新） | 只在 MR 上跑 |
| `go:notify-feishu` | 飞书通知 | 没配密钥时打印跳过说明并以 0 退出 |

## 门禁清单（每个都能失败，且对应一个真实风险）

| 门禁 | 怎么失败 | 防的是什么 |
| --- | --- | --- |
| 仓库契约 | 缺 `go.mod` / `AGENTS.md`，或 `.gitlab-ci.yml` 没有分发到 `data_ai/cicd` 的 `go-service` | 仓库接错套件，或规范文件缺失后无人维护 |
| 代码位置 | Go 文件不在 `cmd/`、`internal/`、`tools/` 下；`package main` 出现在 `cmd/` 之外 | 入口散落、包边界被破坏 |
| 分层 | `internal/protocol` 依赖 center/node/drivers/store；`internal/drivers` 依赖 center/node；`internal/store` 依赖上层；`internal/` 引用 `cmd/` | 协议层被业务实现污染，改一处崩两处 |
| 硬编码机器路径 | `cmd/`、`internal/`、`tools/` 的源码出现盘符路径、`/home/`、`/Users/`、`file://`（注释除外） | 换机器跑不了，或悄悄写到别人机器上 |
| 格式 | `gofmt -l` 输出非空；`internal/webui/assets/` 存在时 prettier 检查失败 | 工程格式漂移 |
| 依赖整洁 | `go mod tidy` 后 `go.mod` / `go.sum` 有改动 | 依赖清单与代码不一致 |
| 交叉编译 | linux/windows amd64 任一编译失败 | 只在本机平台能跑 |
| 单元测试 | `go test -race ./...` 任一用例失败 | 行为回归与数据竞争 |
| 覆盖率 | 总覆盖率低于 70%，或语句数 ≥10 的包低于 60% | 新逻辑没被测到就合进主干 |
| 语义审计 | 契约要求 `BLOCK` 或报告 `INVALID` | 机械检查覆盖不到的语义问题：复杂度、冗余、设计不连贯、门禁必要性、耦合、并发与资源管理 |

门禁之间不重复拦同一件事：机械检查只判可机械判定的内容，语义审计不重复它们的结论。

## 覆盖率口径

- 默认只统计 `internal/**`：`cmd/` 是进程装配，靠端到端验证。
- 阈值与统计范围由调用方仓库的 `ci/coverage.json` 决定（缺省 `overall_min=70`、`package_min=60`、`scope="internal/"`、`package_min_statements=10`）；数值与口径必须和被审仓库一起评审、一起改。
- 覆盖率摘要作为 artifact 提供给语义审计参考，不做机械比较。

## 语义审计边界

- 输入只有审计上下文 + 只读工作区；源码不内联进 prompt，模型按索引自己 `Read`。
- 工具只给 `Read`：不能执行、不能写、不能联网。
- 结论必须带「仓库相对路径 + 行号」证据；证据不足只能报 REVIEW。
- `BLOCK` 只留给三种情况：高置信矛盾、会让功能选错路径的入口/边界歧义、有证据的死代码或永远为真的门禁。

## 加新门禁的规矩

1. 门禁必须能失败，且能说清对应哪个真实风险；说不清就不加。
2. 门禁要么进 `check-go-structure.mjs` 与 `go:toolchain`（机械类），要么写进审计契约（语义类），不要两处各写一半。
3. 新脚本必须被 `templates/go-service.yml` 引用，且被 `go-service-cicd.test.mjs` 覆盖（含「模板引用的脚本必须存在」这条断言）。
4. 调用方分发到中心 CI 的版本按分支 `main` 走（与现有 GitLab 套件一致）；改 CI 逻辑属于质量策略变更，走正常 MR。

## 调用方需要配置的变量

- `go-cicd-audit` 环境：`ANTHROPIC_API_KEY`（语义审计，DeepSeek 的 Anthropic 兼容端点）。
- `go-cicd-notify` 环境：`GITLAB_API_TOKEN`、`FEISHU_ADMIN_GITLAB_LOGINS`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DEFAULT_CHAT_ID`、`FEISHU_RECIPIENT_MAP_JSON`；未配置完整飞书凭据时通知跳过，不阻断代码检查。
- 调用方项目需在 `Settings → CI/CD → Job token permissions` 允许 `data_ai/cicd`。
