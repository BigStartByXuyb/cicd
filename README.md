# MW 插件系统 CI/CD

MW 插件系统共享流水线仓库，包含插件市场与桌面客户端的 GitLab CI 模板、GitHub Actions 工作流和校验脚本。

## GitLab CI

调用仓库的 `.gitlab-ci.yml` 只触发本仓库的下游流水线，并传入仓库路径、提交 SHA、MR 元数据和套件名。实际 job 全部在本仓库运行：

- `templates/common.yml` 定义中央流水线阶段、源码检出和共享设置。
- `templates/plugin-marketplace.yml` 定义插件市场检查、测试、审计、报告和通知任务。
- `templates/desktop-app.yml` 定义桌面客户端检查、构建、测试、审计、报告和通知任务。

中央流水线通过 `CI_JOB_TOKEN` 检出调用仓库的指定提交。每个源码项目必须在 **Settings → CI/CD → Job token permissions** 中允许 `data_ai/cicd`。桌面客户端套件还会检出 `data_ai/plugins` 作为运行时夹具，因此插件项目也必须允许 `data_ai/cicd`。下游流水线按传入的完整 commit SHA 校验检出结果。

触发用户必须有权限在本项目启动下游流水线。密钥统一配置在本项目的 CI/CD Variables，并按用途隔离环境作用域：`*-audit` 仅配置 `ANTHROPIC_API_KEY`；`*-notify` 配置 `GITLAB_API_TOKEN`、`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_DEFAULT_CHAT_ID` 和 `FEISHU_RECIPIENT_MAP_JSON`。这些值不存放在仓库中；敏感变量使用 Masked 和 Protected。

源码检出 job 只准备源码 artifact，不运行调用仓库代码；执行仓库代码的 job 不保留 `CI_JOB_TOKEN`。GitLab API 令牌仅用于回写调用仓库的 MR 报告，并须有对应项目的 MR notes 权限。

## GitHub Actions

`.github/workflows/` 保留插件市场和桌面客户端的 GitHub Actions 入口；套件实现位于 `projects/`，共用实现位于 `shared/`。

## 目录

- `templates/`：中央 GitLab 下游流水线模板。
- `projects/plugin-marketplace/`：插件市场流水线实现、校验规则和说明。
- `projects/desktop-app/`：桌面客户端流水线实现、校验规则和说明。
- `shared/`：两套流水线共用的报告和通知实现。
