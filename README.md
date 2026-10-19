# MW 插件系统 CI/CD

MW 插件系统共享流水线仓库，包含插件市场与桌面客户端的 GitLab CI 模板、GitHub Actions 工作流和校验脚本。

## GitLab CI

调用仓库的 `.gitlab-ci.yml` 只触发本仓库的下游流水线，并传入仓库路径、提交 SHA、MR 元数据和套件名。实际 job 全部在本仓库运行：

- `templates/common.yml` 定义中央流水线阶段、源码检出和共享设置。
- `templates/plugin-marketplace.yml` 定义插件市场检查、测试、审计、报告和通知任务。
- `templates/desktop-app.yml` 定义桌面客户端检查、构建、测试、审计、报告和通知任务。

中央流水线通过 `CI_JOB_TOKEN` 检出调用仓库的指定提交。每个源码项目必须在 **Settings → CI/CD → Job token permissions** 中允许 `data_ai/cicd`。桌面客户端套件还会检出 `data_ai/plugins` 作为运行时夹具，因此插件项目也必须允许 `data_ai/cicd`。下游流水线按传入的完整 commit SHA 校验检出结果。

触发用户必须有权限在本项目启动下游流水线。密钥统一配置在本项目的 CI/CD Variables，并按用途隔离环境作用域：`*-audit` 配置 `ANTHROPIC_API_KEY`；`*-notify` 配置 `GITLAB_API_TOKEN` 和可选的 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DEFAULT_CHAT_ID`、`FEISHU_RECIPIENT_MAP_JSON`。未配置完整飞书凭据时通知会跳过，不阻断代码检查。这些值不存放在仓库中；敏感变量使用 Masked 和 Protected。

Feishu 在流水线启动以及源码、检查、测试、审计、报告和通知阶段完成时向提交者发送状态。失败状态包含失败 job 直达链接和脱敏后的日志摘要，并同时提供中央流水线与调用仓库流水线链接。语义审计通知列出普通建议标题，并直链最终报告文件。未配置提交者 `open_id` 映射时，状态回退到默认维护群。语义审计 `REVIEW` 是非阻断结论，CI job 会成功，但需要管理员查看复核项。所有 CI job 成功后，末尾验收阶段单独通知管理员群，并列出审计复核标题及审计 job 和报告 job 链接。

源码检出 job 只准备源码 artifact，不运行调用仓库代码；执行仓库代码的 job 不保留 `CI_JOB_TOKEN`。GitLab API 令牌仅用于回写调用仓库的 MR 报告，并须有对应项目的 MR notes 权限。

## GitHub Actions

`.github/workflows/` 保留插件市场和桌面客户端的 GitHub Actions 入口；套件实现位于 `projects/`，共用实现位于 `shared/`。

## 目录

- `templates/`：中央 GitLab 下游流水线模板。
- `projects/plugin-marketplace/`：插件市场流水线实现、校验规则和说明。
- `projects/desktop-app/`：桌面客户端流水线实现、校验规则和说明。
- `shared/`：两套流水线共用的报告和通知实现。
